#!/usr/bin/env node
/**
 * Network Monitor — Event-Driven (Socket + Keepalive)
 *
 * 架構：
 *   持有一條 TCP 連線到 1.1.1.1:53（Cloudflare DNS）
 *   OS 層 TCP keepalive 每 3 秒探一次，無回應 8 秒後觸發 timeout
 *   狀態機：INIT → ONLINE ⇄ TESTING ⇄ OFFLINE
 *
 * 偵測速度：
 *   斷線：< 3 秒（keepalive timeout 或 ENETDOWN 立即觸發）
 *   恢復：< 1 秒（reconnect 成功即通知）
 *
 * 不穩定偵測：
 *   5 分鐘內斷線 ≥ 3 次 → 通知中加上不穩定警告
 *
 * 啟動：node network-monitor.js
 * Log：logs/network-monitor.log
 */

const net  = require('net');
const http = require('http');
const fs   = require('fs');
const path = require('path');

// ── 設定 ──────────────────────────────────────────────────────────────────────
const HOST              = '1.1.1.1';      // Cloudflare DNS（比 8.8.8.8 更適合持久連線）
const PORT              = 53;
const KEEPALIVE_MS      = 3000;           // TCP keepalive probe 間隔
const TIMEOUT_MS        = 8000;           // 無回應視為斷線
const RECONNECT_MS      = 2000;           // 離線時重連間隔
const SC_THRESHOLD_MS   = 800;            // ≤ 800ms 重連成功 = server-side close（不通知）
const INSTABILITY_WIN   = 5 * 60 * 1000; // 不穩定偵測窗口：5 分鐘
const INSTABILITY_MIN   = 3;             // 窗口內斷線 ≥ 3 次視為不穩定

const N8N_WEBHOOK = 'http://localhost:5678/webhook';
const LOG_FILE    = path.join(__dirname, '..', 'logs', 'network-monitor.log');

// ── 狀態 ──────────────────────────────────────────────────────────────────────
const S = { INIT: 'init', ONLINE: 'online', TESTING: 'testing', OFFLINE: 'offline' };

let state     = S.INIT;
let socket    = null;
let downSince = null;   // ISO string，斷線時刻
let testStart = null;   // TESTING 開始時間（ms）

const dropHistory = [];  // 已確認斷線的時間戳（ms）

// ── 日誌 ──────────────────────────────────────────────────────────────────────
function log(msg) {
  const ts   = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const line = `[${ts}] [${state.toUpperCase()}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {}
}

// ── 不穩定追蹤 ────────────────────────────────────────────────────────────────
function recordDrop() {
  const now = Date.now();
  while (dropHistory.length && (now - dropHistory[0]) > INSTABILITY_WIN) dropHistory.shift();
  dropHistory.push(now);
  return dropHistory.length;
}

function getDropCount() {
  const now = Date.now();
  return dropHistory.filter(t => (now - t) <= INSTABILITY_WIN).length;
}

// ── Webhook ───────────────────────────────────────────────────────────────────
function postWebhook(endpoint, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req  = http.request(`${N8N_WEBHOOK}/${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error',   (err) => { log(`POST ${endpoint} 失敗: ${err.message}`); resolve(null); });
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.write(data);
    req.end();
  });
}

// ── 斷線確認（由多處呼叫）────────────────────────────────────────────────────
async function confirmDown(reason) {
  state = S.OFFLINE;
  const drops    = recordDrop();
  const unstable = drops >= INSTABILITY_MIN;
  log(`斷線確認！(${reason}) drops=${drops}${unstable ? ' ⚠️不穩定' : ''}`);
  await postWebhook('network-down', { downSince, unstable, dropCount: drops });
}

// ── Socket 事件 ────────────────────────────────────────────────────────────────
async function onConnect() {
  if (state === S.INIT) {
    log('啟動完成，網路正常。');
    state = S.ONLINE;

  } else if (state === S.TESTING) {
    const elapsed = Date.now() - testStart;
    if (elapsed <= SC_THRESHOLD_MS) {
      // Server-side close：重連太快，不算真正斷線
      log(`Server-side close（${elapsed}ms 重連成功），不推送。`);
      state     = S.ONLINE;
      downSince = null;
    } else {
      // 超過門檻才重連 → 算短暫斷線
      log(`網路短暫中斷後恢復（${elapsed}ms）。`);
      const drops    = recordDrop();
      const unstable = drops >= INSTABILITY_MIN;
      await postWebhook('network-recovered', { downSince, unstable, dropCount: drops });
      state     = S.ONLINE;
      downSince = null;
    }

  } else if (state === S.OFFLINE) {
    const drops    = getDropCount();
    const unstable = drops >= INSTABILITY_MIN;
    log(`網路恢復！drops=${drops}${unstable ? ' ⚠️不穩定' : ''}`);
    await postWebhook('network-recovered', { downSince, unstable, dropCount: drops });
    state     = S.ONLINE;
    downSince = null;
  }
}

async function onError(err) {
  socket.destroy();

  if (state === S.ONLINE || state === S.INIT) {
    downSince = new Date().toISOString();
    await confirmDown(err.code || err.message);
  } else if (state === S.TESTING) {
    // 測試性重連也失敗 → 確認真實斷線
    await confirmDown(err.code || err.message);
  }
  // OFFLINE：已通知過，繼續重連

  scheduleReconnect(RECONNECT_MS);
}

function onTimeout() {
  socket.destroy();
  onError(new Error('ETIMEDOUT'));
}

async function onClose() {
  socket.destroy();

  if (state === S.ONLINE) {
    // 未知 close：可能是 server-side 或真實斷線，進入 TESTING
    state     = S.TESTING;
    testStart = Date.now();
    downSince = new Date().toISOString();
    log(`Socket closed，快速重連測試中...`);
    scheduleReconnect(100);  // 幾乎立即重連

  } else if (state === S.TESTING) {
    // 二次 close → 確認斷線
    await confirmDown('double close');
    scheduleReconnect(RECONNECT_MS);

  } else if (state === S.OFFLINE) {
    scheduleReconnect(RECONNECT_MS);
  }
}

// ── 連線管理 ──────────────────────────────────────────────────────────────────
function scheduleReconnect(delay) {
  setTimeout(connect, delay);
}

function connect() {
  socket = new net.Socket();
  socket.setKeepAlive(true, KEEPALIVE_MS);
  socket.setTimeout(TIMEOUT_MS);
  socket.on('connect', onConnect);
  socket.on('error',   onError);
  socket.on('timeout', onTimeout);
  socket.on('close',   onClose);
  socket.connect(PORT, HOST);
}

// ── 啟動 ──────────────────────────────────────────────────────────────────────
log(`Network Monitor 啟動（event-driven, ${HOST}:${PORT}, keepalive=${KEEPALIVE_MS}ms, timeout=${TIMEOUT_MS}ms）`);
connect();

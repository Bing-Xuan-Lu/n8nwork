#!/usr/bin/env node
/**
 * Network Monitor — TLS Persistent Connection
 *
 * 架構：
 *   持有一條 TLS 連線到 1.1.1.1:443（Cloudflare HTTPS）
 *   OS 層 TCP keepalive 每 5 秒探一次，斷線時由 OS 觸發 error 事件
 *   狀態機：INIT → ONLINE ⇄ TESTING ⇄ OFFLINE
 *
 * Log 原則：只記錄真實斷線與恢復（Server-side close 視為正常，靜默處理）
 *
 * 啟動：node network-monitor.js
 * Log：logs/network-monitor.log
 */

const tls  = require('tls');
const http = require('http');
const fs   = require('fs');
const path = require('path');

// ── 設定 ──────────────────────────────────────────────────────────────────────
const HOST             = '1.1.1.1';
const PORT             = 443;
const KEEPALIVE_MS     = 5000;           // TCP keepalive probe 間隔
const RECONNECT_MS     = 3000;           // 初始重連間隔
const RECONNECT_MAX_MS = 60000;          // 指數退避上限（60 秒）
const SC_THRESHOLD_MS  = 1200;           // ≤ 1200ms 重連成功 = server-side close（靜默）
const INSTABILITY_WIN  = 5 * 60 * 1000; // 不穩定偵測窗口：5 分鐘
const INSTABILITY_MIN  = 3;             // 窗口內斷線 ≥ 3 次視為不穩定

const N8N_WEBHOOK = 'http://localhost:5678/webhook';
const LOG_FILE    = path.join(__dirname, '..', 'logs', 'network-monitor.log');

// ── 狀態 ──────────────────────────────────────────────────────────────────────
const S = { INIT: 'init', ONLINE: 'online', TESTING: 'testing', OFFLINE: 'offline' };

let state          = S.INIT;
let socket         = null;
let downSince      = null;
let testStart      = null;
let reconnectDelay = RECONNECT_MS;
let reconnecting   = false;

const dropHistory = [];

// ── 日誌（只記錄啟動、真實斷線、恢復）──────────────────────────────────────
function log(msg) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts  = `${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()} `
            + `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const line = `[${ts}] ${msg}`;
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
    req.on('error', (err) => { log(`[WARN] POST ${endpoint} 失敗: ${err.message}`); resolve(null); });
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.write(data);
    req.end();
  });
}

// ── 斷線確認 ──────────────────────────────────────────────────────────────────
async function confirmDown(reason) {
  state = S.OFFLINE;
  const drops    = recordDrop();
  const unstable = drops >= INSTABILITY_MIN;
  log(`[DOWN] 斷線確認（${reason}）drops=${drops}${unstable ? ' ⚠️不穩定' : ''}`);
  await postWebhook('network-down', { downSince, unstable, dropCount: drops });
}

// ── Socket 安全銷毀（移除所有監聽器，防止 destroy 觸發 close）────────────────
function destroySocket() {
  if (!socket) return;
  socket.removeAllListeners();
  socket.destroy();
  socket = null;
}

// ── 排程重連（指數退避 + 防重複）────────────────────────────────────────────
function scheduleReconnect(delay) {
  if (reconnecting) return;
  reconnecting = true;
  setTimeout(() => {
    reconnecting = false;
    connect();
  }, delay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

// ── Socket 事件 ────────────────────────────────────────────────────────────────
async function onConnect() {
  reconnectDelay = RECONNECT_MS;  // 連線成功，重置退避

  if (state === S.INIT) {
    log('[START] 啟動完成，網路正常。');
    state = S.ONLINE;

  } else if (state === S.TESTING) {
    const elapsed = Date.now() - testStart;
    if (elapsed <= SC_THRESHOLD_MS) {
      // Server-side close：快速重連成功，靜默處理
      state     = S.ONLINE;
      downSince = null;
    } else {
      // 重連時間超過門檻 → 算短暫斷線
      log(`[UP] 網路短暫中斷後恢復（${elapsed}ms）。`);
      const drops    = recordDrop();
      const unstable = drops >= INSTABILITY_MIN;
      await postWebhook('network-recovered', { downSince, unstable, dropCount: drops });
      state     = S.ONLINE;
      downSince = null;
    }

  } else if (state === S.OFFLINE) {
    const drops    = getDropCount();
    const unstable = drops >= INSTABILITY_MIN;
    log(`[UP] 網路恢復！drops=${drops}${unstable ? ' ⚠️不穩定' : ''}`);
    await postWebhook('network-recovered', { downSince, unstable, dropCount: drops });
    state     = S.ONLINE;
    downSince = null;
  }
}

async function onError(err) {
  destroySocket();

  if (state === S.ONLINE || state === S.INIT) {
    downSince = new Date().toISOString();
    await confirmDown(err.code || err.message);
  } else if (state === S.TESTING) {
    await confirmDown(err.code || err.message);
  }
  // OFFLINE：已通知過，繼續重連

  const delay = (err.code === 'EADDRINUSE' || err.code === 'ENOBUFS')
    ? RECONNECT_MAX_MS
    : reconnectDelay;
  scheduleReconnect(delay);
}

async function onClose() {
  destroySocket();

  if (state === S.ONLINE) {
    // 可能是 server-side close 或真實斷線，進入 TESTING 快速驗證
    state     = S.TESTING;
    testStart = Date.now();
    downSince = new Date().toISOString();
    scheduleReconnect(200);  // 稍等 TLS 重連

  } else if (state === S.TESTING) {
    // 二次 close → 確認斷線
    await confirmDown('connection lost');
    scheduleReconnect(reconnectDelay);

  } else if (state === S.OFFLINE) {
    scheduleReconnect(reconnectDelay);
  }
}

// ── 連線（TLS 到 1.1.1.1:443）────────────────────────────────────────────────
function connect() {
  socket = tls.connect({
    host:               HOST,
    port:               PORT,
    servername:         'one.one.one.one',  // SNI
    rejectUnauthorized: false,              // 只測連通性，不驗憑證
  });
  socket.setKeepAlive(true, KEEPALIVE_MS);
  socket.on('secureConnect', onConnect);
  socket.on('error',         onError);
  socket.on('close',         onClose);
}

// ── 啟動 ──────────────────────────────────────────────────────────────────────
log(`[INIT] Network Monitor 初始化（TLS ${HOST}:${PORT}, keepalive=${KEEPALIVE_MS}ms）`);
connect();

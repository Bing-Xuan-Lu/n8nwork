#!/usr/bin/env node
/**
 * AI Bridge Server
 * 讓 n8n (Docker) 能透過此橋接伺服器呼叫 Windows 本地 CLI 工具
 *
 * 啟動方式:  node ai-bridge.js
 * n8n 呼叫:  http://host.docker.internal:3001/translate
 *
 * 優先順序: Claude CLI → Gemini CLI
 */

const http = require('http');
const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PORT    = 3001;
const TIMEOUT = 120000; // 2 分鐘

/**
 * 將 prompt 寫入暫存檔後呼叫 CLI (stdin 重導向)
 * 等同 shell: command args... < tmpfile.txt
 */
function callCLI(command, args, prompt) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `ai-bridge-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, prompt, 'utf-8');

    let fd;
    try {
      fd = fs.openSync(tmpFile, 'r');
    } catch (e) {
      return reject(e);
    }

    console.log(`  ▶ ${command} ${args.join(' ')} < tmpfile`);

    const proc = spawn(command, args, {
      stdio: [fd, 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env }
    });

    fs.closeSync(fd);

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`${command} 超時 (${TIMEOUT / 1000}s)`));
    }, TIMEOUT);

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('error', err => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch {}
      reject(new Error(`找不到 ${command}：${err.message}`));
    });

    proc.on('close', code => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch {}

      const result = stdout.trim();
      if (result) {
        resolve(result);
      } else {
        reject(new Error(`${command} 無輸出 (exit ${code}): ${stderr.substring(0, 300)}`));
      }
    });
  });
}

/**
 * Claude CLI 翻譯
 *
 * Claude Code CLI 旗標說明：
 *   claude --print   → 非互動模式，從 stdin 讀取 prompt
 *   claude -p "..."  → 非互動模式，prompt 作為參數
 *
 * 若您的 claude 命令不同，請調整 args。
 */
async function translateWithClaude(prompt) {
  // 優先用 stdin 方式（不受 Windows 命令列長度限制）
  try {
    return await callCLI('claude', ['--print'], prompt);
  } catch (err) {
    if (err.message.includes('找不到')) throw err; // CLI 不存在直接拋出
    console.warn('  claude --print 失敗，改用 -p 參數模式...');
    // 備援：-p 參數模式（限制 prompt 長度避免命令列過長）
    return await callCLI('claude', ['-p', prompt.substring(0, 8000)], '');
  }
}

/**
 * Gemini CLI 翻譯
 *
 * Google Gemini CLI 旗標說明：
 *   gemini          → 若支援 stdin 則直接使用
 *   gemini -p "..." → prompt 作為參數（若有此旗標）
 *
 * 若您的 gemini 命令不同，請調整 args。
 */
async function translateWithGemini(prompt) {
  try {
    return await callCLI('gemini', [], prompt);
  } catch (err) {
    if (err.message.includes('找不到')) throw err;
    console.warn('  gemini stdin 失敗，改用 -p 參數模式...');
    return await callCLI('gemini', ['-p', prompt.substring(0, 8000)], '');
  }
}

// ────────────────────────────────────────────────
// HTTP 伺服器
// ────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 健康檢查
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    return;
  }

  // 翻譯端點
  if (req.method === 'POST' && req.url === '/translate') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      const t0 = Date.now();
      let prompt;

      try {
        const parsed = JSON.parse(body);
        prompt = parsed.prompt;
        if (!prompt) throw new Error('缺少 prompt 欄位');
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
        return;
      }

      console.log(`\n📥 收到翻譯請求 (${prompt.length} 字)`);

      let text, model;

      // === 第一優先：Claude CLI ===
      try {
        console.log('🤖 [Claude CLI]');
        text  = await translateWithClaude(prompt);
        model = 'claude';
        console.log(`✅ Claude 完成 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      } catch (claudeErr) {
        console.warn(`⚠️  Claude 失敗: ${claudeErr.message}`);

        // === 備援：Gemini CLI ===
        try {
          console.log('💎 [Gemini CLI]');
          text  = await translateWithGemini(prompt);
          model = 'gemini';
          console.log(`✅ Gemini 完成 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        } catch (geminiErr) {
          console.error(`❌ Gemini 也失敗: ${geminiErr.message}`);
          res.writeHead(500);
          res.end(JSON.stringify({
            error: '所有 CLI 都失敗了',
            claude: claudeErr.message,
            gemini: geminiErr.message
          }));
          return;
        }
      }

      res.writeHead(200);
      res.end(JSON.stringify({ text, model }));
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} 已被占用！`);
  } else {
    console.error('Server 錯誤:', err);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('═'.repeat(52));
  console.log('  🚀 AI Bridge Server 已啟動');
  console.log('═'.repeat(52));
  console.log(`  Port  : ${PORT}`);
  console.log(`  健康  : http://localhost:${PORT}/health`);
  console.log(`  翻譯  : POST http://localhost:${PORT}/translate`);
  console.log(`  n8n用 : http://host.docker.internal:${PORT}/translate`);
  console.log('═'.repeat(52));
  console.log('  等待請求...\n');
});

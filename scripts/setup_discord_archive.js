const http = require('http');
const env = require('./_env');

const N8N_KEY = env.N8N_API_KEY;
const BOT_TOKEN = env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = env.DISCORD_ARCHIVE_CHANNEL;

function apiCall(method, path, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : '{}';
    const req = http.request({
      hostname: 'localhost', port: 5678,
      path: `/api/v1${path}`, method,
      headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Code node: 過濾並準備 ───────────────────────────────────────────
const prepareCode = `const items = $input.all();

// Discord API 回傳 array，n8n 可能包成一個 item 或多個 items
let messages = [];
if (items.length === 1 && Array.isArray(items[0].json)) {
  messages = items[0].json;
} else {
  messages = items.map(i => i.json);
}

// 只取 bot 發的訊息（webhook 發的 author.bot === true）
const botMsgs = messages.filter(m => m && m.author && m.author.bot === true);

if (botMsgs.length === 0) {
  return [{ json: { sql: null, ids: [], count: 0 } }];
}

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  return "'" + String(val)
    .replace(/\\\\/g, '\\\\\\\\')
    .replace(/'/g, "\\\\'")
    .replace(/\\n/g, '\\\\n')
    .replace(/\\r/g, '\\\\r')
    .replace(/\\0/g, '\\\\0') + "'";
}

function fmtDate(ts) {
  return new Date(ts).toISOString().replace('T', ' ').substring(0, 19);
}

const rows = botMsgs.map(m => {
  const content = m.content || (m.embeds?.length > 0 ? '[embed]' : '');
  return \`(\${esc(m.id)}, \${esc('${CHANNEL_ID}')}, \${esc(content)}, \${esc(m.author.username || m.author.global_name || '')}, \${esc(m.author.id)}, \${esc(fmtDate(m.timestamp))})\`;
});

const sql = \`INSERT IGNORE INTO discord_messages (message_id, channel_id, content, author_name, author_id, sent_at) VALUES \${rows.join(', ')}\`;

return [{ json: { sql, ids: botMsgs.map(m => m.id), count: botMsgs.length } }];`;

// ── Code node: 準備刪除清單 ────────────────────────────────────────
const splitIdsCode = `const ids = $('過濾並準備').first().json.ids;
return ids.map(id => ({ json: { message_id: id } }));`;

// ── Code node: 結果摘要 ────────────────────────────────────────────
const summaryCode = `const prepData = $('過濾並準備').first().json;
const deleteItems = $input.all();
const ok = deleteItems.filter(i => !i.error).length;
return [{ json: {
  result: \`✅ 寫入 \${prepData.count} 則，Discord 刪除 \${ok}/\${prepData.count} 則\`,
  written: prepData.count,
  deleted: ok
}}];`;

async function main() {
  // Step 1: Discord Bot credential
  console.log('Step 1: 建立 Discord Bot credential...');
  const discR = await apiCall('POST', '/credentials', {
    name: 'Discord Bot (archive)',
    type: 'httpHeaderAuth',
    data: { name: 'Authorization', value: `Bot ${BOT_TOKEN}` }
  });
  if (!discR.body.id) { console.error('Discord cred 失敗:', discR.body); process.exit(1); }
  const DISCORD_CRED_ID = discR.body.id;
  console.log(`  → ID: ${DISCORD_CRED_ID}`);

  // Step 2: MySQL credential
  console.log('Step 2: 建立 MySQL credential...');
  const mysqlR = await apiCall('POST', '/credentials', {
    name: 'discord_bot_db',
    type: 'mySql',
    data: { host: env.MYSQL_HOST, port: Number(env.MYSQL_PORT), user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: env.MYSQL_DB, ssl: false, sshTunnel: false }
  });
  if (!mysqlR.body.id) { console.error('MySQL cred 失敗:', mysqlR.body); process.exit(1); }
  const MYSQL_CRED_ID = mysqlR.body.id;
  console.log(`  → ID: ${MYSQL_CRED_ID}`);

  // Step 3: Create workflow
  console.log('Step 3: 建立工作流...');
  const workflow = {
    name: "Discord BOT 訊息歸檔",
    nodes: [
      {
        id: "trigger", name: "手動觸發",
        type: "n8n-nodes-base.manualTrigger", typeVersion: 1,
        position: [-900, 0], parameters: {}
      },
      {
        id: "fetch", name: "讀取 Discord 訊息",
        type: "n8n-nodes-base.httpRequest", typeVersion: 4.2,
        position: [-600, 0],
        parameters: {
          method: "GET",
          url: `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`,
          sendQuery: true,
          queryParameters: { parameters: [{ name: "limit", value: "100" }] },
          authentication: "predefinedCredentialType",
          nodeCredentialType: "httpHeaderAuth",
          options: {}
        },
        credentials: { httpHeaderAuth: { id: DISCORD_CRED_ID, name: "Discord Bot (archive)" } }
      },
      {
        id: "prepare", name: "過濾並準備",
        type: "n8n-nodes-base.code", typeVersion: 2,
        position: [-300, 0],
        parameters: { mode: "runOnceForAllItems", jsCode: prepareCode }
      },
      {
        id: "if-has", name: "有 BOT 訊息",
        type: "n8n-nodes-base.if", typeVersion: 2.2,
        position: [0, 0],
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
            conditions: [{ id: "c1", leftValue: "={{ $json.count }}", rightValue: 0, operator: { type: "number", operation: "gt" } }],
            combinator: "and"
          }
        }
      },
      {
        id: "mysql-write", name: "寫入 MySQL",
        type: "n8n-nodes-base.mySql", typeVersion: 2.4,
        position: [300, -120],
        parameters: { operation: "executeQuery", query: "={{ $json.sql }}" },
        credentials: { mySql: { id: MYSQL_CRED_ID, name: "discord_bot_db" } }
      },
      {
        id: "split-ids", name: "準備刪除清單",
        type: "n8n-nodes-base.code", typeVersion: 2,
        position: [600, -120],
        parameters: { mode: "runOnceForAllItems", jsCode: splitIdsCode }
      },
      {
        id: "discord-delete", name: "刪除 Discord 訊息",
        type: "n8n-nodes-base.httpRequest", typeVersion: 4.2,
        position: [900, -120],
        parameters: {
          method: "DELETE",
          url: `=https://discord.com/api/v10/channels/${CHANNEL_ID}/messages/{{ $json.message_id }}`,
          authentication: "predefinedCredentialType",
          nodeCredentialType: "httpHeaderAuth",
          options: { response: { response: { neverError: true } } }
        },
        credentials: { httpHeaderAuth: { id: DISCORD_CRED_ID, name: "Discord Bot (archive)" } }
      },
      {
        id: "summary", name: "結果摘要",
        type: "n8n-nodes-base.code", typeVersion: 2,
        position: [1200, -120],
        parameters: { mode: "runOnceForAllItems", jsCode: summaryCode }
      }
    ],
    connections: {
      "手動觸發": { main: [[{ node: "讀取 Discord 訊息", type: "main", index: 0 }]] },
      "讀取 Discord 訊息": { main: [[{ node: "過濾並準備", type: "main", index: 0 }]] },
      "過濾並準備": { main: [[{ node: "有 BOT 訊息", type: "main", index: 0 }]] },
      "有 BOT 訊息": { main: [
        [{ node: "寫入 MySQL", type: "main", index: 0 }],
        []
      ]},
      "寫入 MySQL": { main: [[{ node: "準備刪除清單", type: "main", index: 0 }]] },
      "準備刪除清單": { main: [[{ node: "刪除 Discord 訊息", type: "main", index: 0 }]] },
      "刪除 Discord 訊息": { main: [[{ node: "結果摘要", type: "main", index: 0 }]] }
    },
    settings: {
      saveExecutionProgress: true,
      saveManualExecutions: true,
      saveDataErrorExecution: "all",
      saveDataSuccessExecution: "all",
      executionOrder: "v1"
    }
  };

  const wfR = await apiCall('POST', '/workflows', workflow);
  if (!wfR.body.id) { console.error('工作流建立失敗:', JSON.stringify(wfR.body)); process.exit(1); }
  const WF_ID = wfR.body.id;
  console.log(`  → 工作流 ID: ${WF_ID}, 名稱: ${wfR.body.name}`);

  // Step 4: Activate (manual trigger doesn't need activation, but activate anyway)
  const actR = await apiCall('POST', `/workflows/${WF_ID}/activate`, {});
  console.log(`Step 4: Activate → ${actR.status}`);

  // Save local backup (without credentials)
  const fs = require('fs');
  const backup = JSON.stringify({ ...wfR.body, _note: 'credentials stored in n8n only' }, null, 2);
  fs.writeFileSync('d:/Develop/n8nwork/flows/Discord_BOT訊息歸檔.json', backup);
  console.log('Done! 備份已儲存至 flows/Discord_BOT訊息歸檔.json');
  console.log(`\n工作流連結: http://localhost:5678/workflow/${WF_ID}`);
}

main().catch(e => { console.error(e); process.exit(1); });

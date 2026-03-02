# CLAUDE.md — n8nwork 專案快速索引

## 專案概述
n8n 自動化工作流系統，以 Docker Compose 運行於 Windows 10 本機。
包含三個主要工作流：天氣推送、AI新聞推送、網路監控，皆推送至 Discord。

---

## 目錄結構

```
n8nwork/
├── docker-compose.yml      # Docker 設定（n8n service）
├── .env                    # 私鑰（不 commit）: N8N_API_KEY, GOOGLE_AUTH 等
├── .mcp.json               # MCP server 設定（n8n API key 在此）
├── flows/                  # 工作流 JSON 備份（手動同步）
│   ├── AI新聞推送.json
│   ├── 天氣推送.json
│   └── 網路監控.json
├── bridge/
│   ├── ai-bridge.js        # 橋接伺服器 port 3001，Claude CLI → Gemini CLI fallback
│   │                        # （AI新聞推送已改直接呼叫 Gemini REST API，此橋接備用）
│   └── network-monitor.js  # 事件驅動 TLS 網路監控（連到 1.1.1.1:443），Windows 原生執行
├── scripts/                # Windows 啟動腳本（register-bridge-task.ps1、register-network-monitor-task.ps1）
└── docs/UPDATE.md          # Docker 更新/備份指南
```

---

## Docker 服務

- **`n8n`** (`n8nio/n8n:latest`) — port 5678，啟動後自動觸發天氣推送 webhook
- **網路監控** — Windows 原生 Node.js（`bridge/network-monitor.js`），工作排程器開機自動啟動

**Network**: `web_shared_network`（bridge）
**Volume**: `n8n_data` → 固定名稱 `n8n_n8n_data`

---

## n8n API

- **Base URL**: `http://localhost:5678/api/v1`
- **API Key**: 見 `.env` 的 `N8N_API_KEY`（同 `.mcp.json`）
- **啟動/停止工作流**:
  ```bash
  # 啟動（MCP activate_workflow 有 415 bug，改用 curl）
  curl -X POST http://localhost:5678/api/v1/workflows/{id}/activate \
    -H "X-N8N-API-KEY: $KEY" -H "Content-Type: application/json" -d "{}"
  ```

---

## 工作流清單

| 工作流 | ID | 觸發方式 | 說明 |
|---|---|---|---|
| 天氣推送 | `mdKFGSBLSuWhI1sc6gS03` | Webhook `weather-push`（Docker 啟動時觸發） | 推送天氣至 Discord bot通知 |
| AI新聞推送 | `ZBjln2ULmeZoCiiA` | Schedule 每日 23:00 | 抓 RSS → Gemini 摘要 → Discord bot_ai新知 |
| 網路監控 | `cPGAOxwlki9pB88x` | Webhook `network-recovered`（Windows Node.js 觸發） | 斷網恢復時通知 Discord bot通知 |
| MCP Server 週報 | `LxwVTKy2YIt80LP1` | Schedule 每週一 09:00 | 抓 GitHub MCP Server → Gemini 評選 5 個 → Discord bot_ai新知 |
| Discord 指令調度器 | `XEX5TLxo9hIgzsG7` | Discord Trigger 即時監聽（community node） | 監聽頻道 1478051589276045362，`!news`/`!週報`/`!help` 指令路由 |

---

## Discord Credentials

| 名稱 | ID | 用途 |
|---|---|---|
| bot_ai新知 | `lrmdeEtQUhigUA6Q` | AI新聞推送 |
| bot通知 | `jZOFvBc02V5SyGwf` | 天氣推送、網路監控 |

---

## AI新聞推送 — Gemini 設定

- **不使用** bridge server（已改直接呼叫 REST API）
- **Endpoint**: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`
- **Credential**: `googlePalmApi`，ID `Xw882n6J03q5FPQI`（Google Gemini(PaLM) Api account）
- **Response 解析**: `$json.candidates?.[0]?.content?.parts?.[0]?.text`

---

## n8n API 關鍵規則（踩坑整理）

1. **settings 必須在 POST/CREATE body 裡**，POST 後 PUT 不會更新 activeVersion
2. **webhookId** 要放 node 頂層（非 parameters 裡），否則 webhook 不會註冊
3. **重用已刪除的 webhook path** → 舊 DB entry → 404；改用新 path
4. **`settings.executionOrder: "v1"`** 必填，否則 worker 崩潰（finished:false）
5. **更新工作流正確流程**: 先 deactivate → PUT → activate（不可跳過 deactivate）
6. **Credential 不能 PUT**，需 DELETE + POST 重建
7. **MCP `activate_workflow`** 有 415 bug，改用 curl 啟動

---

## 常用指令

```bash
# 啟動/停止 Docker
docker compose up -d
docker compose down
docker compose logs -f n8n

# 更新 n8n
docker compose pull && docker compose up -d

# 查看工作流執行記錄
curl -s http://localhost:5678/api/v1/executions?limit=5 \
  -H "X-N8N-API-KEY: $(grep N8N_API_KEY .env | cut -d= -f2)" | jq .
```

---

## flows/ 同步說明

`flows/` 為手動備份，修改工作流後需手動更新 JSON（從 n8n GET workflow 取得並覆寫）。

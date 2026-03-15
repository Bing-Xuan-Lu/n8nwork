# n8nwork

以 Docker 運行的 n8n 自動化工作流程，結合 Windows 原生服務，推送天氣、AI 新聞、MCP 週報至 Discord，並支援 Discord 指令即時觸發。

## 架構

```text
開機
  │
  ├── Docker Desktop 自動啟動
  │     └── n8n 容器 (port 5678)
  │           └── 啟動腳本：等待 n8n 就緒 → 觸發天氣 Webhook
  │
  └── Windows 工作排程器 自動啟動
        └── network-monitor.js  ← TLS 監控 1.1.1.1:443，斷線時打 Webhook
```

```text
Workflow 執行流程：

[天氣推送]
Webhook → Open-Meteo API → 格式化 → Discord (bot通知)

[AI新聞推送]
Schedule/Webhook → RSS 科技新報 ──┐
                  RSS TechOrange ──┤ Merge → 篩選+評分 → Gemini REST API → 組合 → Discord (bot_ai新知)

[MCP Server 週報]
Schedule/Webhook → GitHub API (topic:mcp-server) → Gemini 評選 → Discord (bot_ai新知)

[Discord 指令調度器]
Discord Trigger → 篩選指令 → Switch
  !news       → 回覆 + 觸發 AI新聞推送 Webhook
  !mcpweeknews → 回覆 + 觸發 MCP週報 Webhook
  !help       → 回覆指令說明

[網路監控]
Windows Node.js (1.1.1.1:443 TLS) → 斷線偵測 → Webhook → Discord (bot通知)
```

---

## 目錄結構

```text
n8nwork/
├── docker-compose.yml      # Docker 設定（n8n service）
├── .env                    # 私鑰（不 commit）: N8N_API_KEY 等
├── .mcp.json               # MCP server 設定（含 n8n API key）
├── flows/                  # 工作流 JSON 備份（手動同步）
├── bridge/
│   ├── ai-bridge.js        # 橋接伺服器 port 3001（備用，AI新聞已改直接呼叫 Gemini REST API）
│   └── network-monitor.js  # 事件驅動 TLS 網路監控，Windows 原生執行
├── scripts/                # Windows 啟動腳本
└── docs/UPDATE.md          # Docker 更新/備份指南
```

---

## MCP Tools 設定

本專案使用兩個互補的 n8n MCP Server：

| Server | 套件 | 定位 |
| --- | --- | --- |
| `n8n` | `@leonardsellem/n8n-mcp-server` | **操作** n8n 實例（CRUD、啟停、執行記錄） |
| `n8n-mcp` | `n8n-mcp`（czlonkowski） | **知識庫**（525+ 節點文件、2700+ 模板、驗證工具） |

另搭配 **n8n-skills**（7 個 Claude Code Skills）指導 AI 正確建立 workflow。

### 新環境安裝

```bash
# 1. 安裝 MCP 套件
npm install -g n8n-mcp
npm install -g @leonardsellem/n8n-mcp-server

# 2. 安裝 n8n-skills（Claude Code Skills）
git clone --depth=1 https://github.com/czlonkowski/n8n-skills.git /tmp/n8n-skills
EXT_DIR="$HOME/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/czlonkowski-n8n-skills"
mkdir -p "$EXT_DIR"
cp -r /tmp/n8n-skills/skills "$EXT_DIR/"
cp /tmp/n8n-skills/.claude-plugin/plugin.json "$EXT_DIR/"
rm -rf /tmp/n8n-skills

# 3. 複製 .mcp.json（含 N8N_API_KEY）並重新啟動 Claude Code
```

---

## 常用指令

```bash
# 啟動/停止 Docker
docker compose up -d
docker compose down
docker compose logs -f n8n

# 更新 n8n
docker compose pull && docker compose up -d

# 手動觸發天氣推送
curl http://localhost:5678/webhook/weather-push

# 查看最近執行記錄
KEY=$(grep N8N_API_KEY .env | cut -d= -f2)
curl -s "http://localhost:5678/api/v1/executions?limit=5" -H "X-N8N-API-KEY: $KEY"
```

---

## 相關連結

- [n8n 官方文件](https://docs.n8n.io)
- [Open-Meteo API](https://open-meteo.com)
- [科技新報 RSS](https://technews.tw/feed/)
- [TechOrange RSS](https://buzzorange.com/techorange/feed/)
- [n8n-mcp（czlonkowski）](https://github.com/czlonkowski/n8n-mcp)
- [n8n-skills](https://github.com/czlonkowski/n8n-skills)

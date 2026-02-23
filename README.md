# n8nwork

以 Docker 運行的 n8n 自動化工作流程，每日開機自動推送天氣預報與 AI 科技新聞到 Discord。

---

## 功能

| Workflow | 頻道 | 說明 |
|---|---|---|
| 天氣推送 | `bot通知` | 每日開機時推送台北士林區今明兩日天氣（每日只推送一次） |
| AI新聞推送 | `bot_ai新知` | 每日開機時從科技新報、TechOrange 抓取 AI 相關新聞，用 Gemini 摘要後推送（已推送過的文章不重複） |

---

## 架構

```
開機
  │
  ├── Docker Desktop 自動啟動
  │     └── n8n 容器 (port 5678)
  │           └── 容器啟動腳本：等待 n8n 就緒 → 觸發 Webhook
  │
  └── Windows 工作排程器 自動啟動
        └── ai-bridge.js (port 3001)  ← Gemini CLI / Claude CLI 橋接器
```

```
n8n Workflow 執行流程：

[天氣推送]
Webhook → Open-Meteo API → 格式化 → Discord (bot通知)

[AI新聞推送]
Webhook → RSS 科技新報 ──┐
         RSS TechOrange ──┤ Merge → 篩選今日/本週新聞 → AI Bridge (Gemini摘要) → 組合訊息 → Discord (bot_ai新知)
```

---

## 檔案說明

| 檔案 | 說明 |
|---|---|
| `docker-compose.yml` | n8n Docker 設定，含開機自動觸發 Webhook 腳本 |
| `.env` | 環境變數（API Key 等，已加入 .gitignore） |
| `bridge/ai-bridge.js` | AI Bridge Server (port 3001)，供 Docker 內的 n8n 呼叫 Windows 本地 Gemini/Claude CLI |
| `bridge/Dockerfile.bridge` | ai-bridge.js 的 Docker 映像（備用，目前用原生 Node.js 運行） |
| `scripts/register-bridge-task.ps1` | 向 Windows 工作排程器註冊 ai-bridge 開機自動啟動 |
| `scripts/start-bridge.vbs` | 靜默啟動 ai-bridge（不顯示命令列視窗） |
| `scripts/startup-weather.ps1` | 舊版手動觸發天氣推送腳本（已由 docker-compose 內建腳本取代） |
| `docs/UPDATE.md` | n8n 版本更新指南 |

---

## n8n Workflow 去重機制

兩個 Workflow 都使用 **n8n Static Data** 儲存已發送紀錄：

- **天氣推送**：記錄 `lastSentDate`，當日已發送則跳過
- **AI新聞推送**：記錄 `sentLinks`（最多 100 筆 URL），已推送過的文章自動過濾

> 新聞篩選優先級：今日新聞 → 本週新聞（7天內） → 無內容則不發送

---

## AI Bridge 說明

`ai-bridge.js` 是一個執行在 Windows 主機的 Node.js HTTP Server，讓 Docker 容器內的 n8n 能夠呼叫本地安裝的 AI CLI 工具。

- 端點：`POST http://host.docker.internal:3001/translate`
- 請求：`{ "prompt": "..." }`
- 回應：`{ "text": "...", "model": "gemini" | "claude" }`
- 優先順序：**Claude CLI → Gemini CLI**（前者失敗自動 fallback）

---

## 常用指令

```bash
# 啟動 n8n
docker compose up -d

# 查看啟動 log（含 webhook 觸發紀錄）
docker compose logs -f

# 停止
docker compose down

# 更新 n8n 至最新版
docker compose pull && docker compose up -d

# 手動觸發天氣推送
curl http://localhost:5678/webhook/weather-push

# 手動觸發 AI 新聞推送
curl http://localhost:5678/webhook/push-ai-news-v3

# 確認 AI Bridge 狀態
curl http://localhost:3001/health
```

---

## 相關連結

- [n8n 官方文件](https://docs.n8n.io)
- [Open-Meteo API](https://open-meteo.com)
- [科技新報 RSS](https://technews.tw/feed/)
- [TechOrange RSS](https://buzzorange.com/techorange/feed/)

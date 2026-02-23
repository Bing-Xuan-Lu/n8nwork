# 安裝指南

> **前提條件**：已安裝 Docker Desktop（含 Docker Compose）

---

## 快速概覽

安裝分為兩個部分：

1. **n8n**（Docker 容器）— 執行 Workflow
2. **AI Bridge**（Windows 原生 Node.js）— 橋接 Gemini/Claude CLI

---

## Part 1：啟動 n8n

### 1-1. 啟動容器

```bash
cd D:\Develop\n8nwork
docker compose up -d
```

等待約 30 秒後，開啟瀏覽器：`http://localhost:5678`

### 1-2. 建立 n8n 帳號

首次進入會要求建立管理員帳號，填入信箱與密碼後登入。

### 1-3. 建立 API Key

1. 右上角頭像 → **Settings**
2. 左側選單 → **API**
3. 點 **Create an API key** → 複製並儲存 Key

將 API Key 更新到 `.env`：

```env
N8N_API_URL=http://localhost:5678/api/v1
N8N_API_KEY=你的_API_KEY
```

---

## Part 2：設定 Discord 憑證

### 2-1. 取得 Discord Webhook URL

1. 在 Discord 頻道設定 → **整合** → **Webhook** → **新增 Webhook**
2. 複製 Webhook URL（需建立兩個，分別給天氣與新聞頻道）

### 2-2. 在 n8n 新增憑證

1. n8n 左側選單 → **Credentials**
2. 點 **Add credential** → 搜尋 **Discord**
3. 選 **Discord Webhook** → 貼上 URL → 儲存
4. 重複一次，建立第二個頻道的 Webhook 憑證

---

## Part 3：匯入 Workflows

### 3-1. 若有備份（.tar.gz）

```bash
# 停止容器
docker compose down

# 還原 volume 資料
docker run --rm -v n8n_n8n_data:/target -v "D:\Develop\n8nwork\backup:/backup" alpine \
  tar xzf /backup/n8n_backup_YYYYMMDD.tar.gz -C /target

# 重新啟動
docker compose up -d
```

### 3-2. 若無備份（全新建立）

依序在 n8n UI 手動建立兩個 Workflow，參考 `README.md` 的架構說明。

建立完成後務必：
- 開啟每個 Workflow 的 **Active** 開關
- 確認 Webhook 節點的路徑：
  - 天氣推送：`weather-push`
  - AI新聞推送：`push-ai-news-v3`

---

## Part 4：安裝 AI Bridge

AI Bridge 讓 n8n 能呼叫本機的 Gemini / Claude CLI 進行摘要。

### 4-1. 安裝 Node.js

前往 [nodejs.org](https://nodejs.org) 下載安裝 LTS 版本。

確認安裝：
```bash
node --version   # v20.x.x 以上
```

### 4-2. 安裝 AI CLI（擇一或兩者都裝）

**Gemini CLI：**
```bash
npm install -g @google/gemini-cli
gemini auth   # 登入 Google 帳號
```

**Claude CLI：**
```bash
npm install -g @anthropic-ai/claude-code
claude auth   # 登入 Anthropic 帳號
```

> AI Bridge 會優先嘗試 Claude，失敗自動 fallback 到 Gemini。

### 4-3. 確認 Bridge 可以啟動

```bash
node D:\Develop\n8nwork\bridge\ai-bridge.js
```

看到以下輸出代表成功：
```
════════════════════════════════════════════════════
  🚀 AI Bridge Server 已啟動
════════════════════════════════════════════════════
  Port  : 3001
  健康  : http://localhost:3001/health
...
```

按 `Ctrl+C` 關閉，進行下一步。

### 4-4. 註冊開機自動啟動（Windows 工作排程器）

以**系統管理員**身份執行 PowerShell，然後執行：

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser   # 若尚未設定
D:\Develop\n8nwork\scripts\register-bridge-task.ps1
```

成功後輸出：
```
[OK] Task created: AI-Bridge-Server
[OK] Bridge server starting on port 3001
```

確認排程器任務已建立：
```powershell
schtasks /query /tn "AI-Bridge-Server"
```

---

## Part 5：驗證

### 5-1. 確認 n8n 正常運作

```bash
curl http://localhost:5678/healthz
# 回應：{"status":"ok"}
```

### 5-2. 確認 AI Bridge 正常運作

```bash
curl http://localhost:3001/health
# 回應：{"status":"ok","time":"..."}
```

### 5-3. 手動觸發 Webhook 測試

```bash
# 天氣推送（應在 Discord bot通知 頻道收到天氣訊息）
curl http://localhost:5678/webhook/weather-push

# AI新聞推送（應在 Discord bot_ai新知 頻道收到新聞摘要）
curl http://localhost:5678/webhook/push-ai-news-v3
```

> 第一次觸發 AI 新聞推送約需 15–30 秒（Gemini 摘要處理中）。

### 5-4. 查看執行紀錄

n8n UI 左側選單 → **Executions** → 確認最近的執行狀態為 ✅ Success。

---

## 疑難排解

### Docker 啟動後沒有自動推送

開機觸發在容器內部執行，可查看 log 確認：

```bash
docker compose logs n8n | grep startup
```

若看到 `n8n 啟動逾時`，代表 n8n 啟動過慢，可手動觸發：

```bash
curl http://localhost:5678/webhook/weather-push
curl http://localhost:5678/webhook/push-ai-news-v3
```

### AI 新聞推送失敗

確認 AI Bridge 是否在運行：
```bash
curl http://localhost:3001/health
```

若沒有回應，手動啟動：
```bash
node D:\Develop\n8nwork\bridge\ai-bridge.js
```

### 已推送過的文章沒有重新出現

這是正常行為（去重機制）。若需要強制重推：
1. n8n UI → 開啟該 Workflow
2. 點選 Code 節點 → 在測試模式執行（測試模式不會更新 Static Data）

---

## 更新 n8n

詳見 `docs/UPDATE.md`。

```bash
docker compose pull && docker compose up -d
```

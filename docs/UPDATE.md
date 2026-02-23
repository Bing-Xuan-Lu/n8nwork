# n8n Docker 更新指南

## 快速更新（3 步驟）

```bash
# 切換到 n8n 目錄
cd D:\Develop\n8nwork

# 1. 拉取最新映像
docker compose pull

# 2. 重新建立容器（資料不會遺失）
docker compose up -d

# 3. 確認版本
docker exec n8n n8n --version
```

---

## 更新前注意事項

- **資料安全**：資料存在 `n8n_data` volume，更新不會遺失
- **建議備份**：重大版本更新前先備份（見下方）
- **查看當前版本**：`docker exec n8n n8n --version`
- **查看最新版本**：https://github.com/n8n-io/n8n/releases

---

## 更新前備份（建議）

```bash
# 備份 volume 資料到本機
docker run --rm -v n8n_data:/source -v D:\Develop\n8nwork\backup:/backup alpine \
  tar czf /backup/n8n_backup_$(date +%Y%m%d).tar.gz -C /source .
```

> Windows PowerShell 用以下指令：
```powershell
$date = Get-Date -Format "yyyyMMdd"
docker run --rm -v n8n_data:/source -v "D:\Develop\n8nwork\backup:/backup" alpine `
  tar czf /backup/n8n_backup_$date.tar.gz -C /source .
```

---

## 還原備份

```bash
# 停止容器
docker compose down

# 還原資料
docker run --rm -v n8n_data:/target -v D:\Develop\n8nwork\backup:/backup alpine \
  tar xzf /backup/n8n_backup_YYYYMMDD.tar.gz -C /target

# 重新啟動
docker compose up -d
```

---

## 指定特定版本（非 latest）

修改 `docker-compose.yml`：

```yaml
image: n8nio/n8n:1.80.0   # 改為指定版本號
```

然後執行：
```bash
docker compose pull
docker compose up -d
```

---

## 常用指令

| 指令 | 說明 |
|------|------|
| `docker compose up -d` | 啟動 |
| `docker compose down` | 停止並移除容器 |
| `docker compose restart` | 重啟 |
| `docker compose logs -f` | 查看即時 log |
| `docker compose pull` | 拉取最新映像 |
| `docker exec n8n n8n --version` | 查看版本 |

/**
 * 讀取 .env，不依賴 dotenv 套件
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
const env = {};
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx < 0) continue;
  env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
}

module.exports = env;

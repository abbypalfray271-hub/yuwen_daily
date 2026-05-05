import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const port = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());

// 数据库初始化 (Async)
const dbPath = path.resolve(__dirname, '../data/daily.db');

async function initDB() {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS activation_codes (
      code TEXT PRIMARY KEY,
      duration_days INTEGER,
      batch_id TEXT,
      status INTEGER DEFAULT 0,
      used_by TEXT,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS code_batches (
      batch_id TEXT PRIMARY KEY,
      count INTEGER,
      duration_days INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

const dbPromise = initDB();

// 数据源路径
const WIKI_PATH = path.join(__dirname, '../../../wiki');

// --- 课件接口 ---

app.get('/api/courseware/list', async (req, res) => {
  try {
    if (!fs.existsSync(WIKI_PATH)) return res.json({ success: true, days: [] });
    const files = fs.readdirSync(WIKI_PATH);
    const daySet = new Set<string>();
    files.forEach(file => {
      const match = file.match(/Day(\d+)_/);
      if (match) daySet.add(match[1]);
    });
    const days = Array.from(daySet).sort((a, b) => parseInt(a) - parseInt(b));
    res.json({ success: true, days });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to scan wiki' });
  }
});

app.get('/api/courseware/get', async (req, res) => {
  const { day, code } = req.query;
  if (!day) return res.status(400).json({ success: false, message: 'Missing day' });

  const isAuthorized = code === '6688' || code === '8888';

  try {
    const files = fs.readdirSync(WIKI_PATH);
    const dayFiles = files.filter(f => f.startsWith(`Day${day}_`));
    const content: Record<string, string> = {};
    
    dayFiles.forEach(file => {
      const typeMatch = file.match(/_(\d+)_(.+)\.md/);
      if (typeMatch) {
        const typeKey = typeMatch[2];
        const rawContent = fs.readFileSync(path.join(WIKI_PATH, file), 'utf-8');
        if (!isAuthorized && (typeKey === 'practice' || typeKey === 'review')) {
          content[typeKey] = '> [!CAUTION]\n> **内容已锁定**\n> 请输入授权码解锁完整答案。';
        } else {
          content[typeKey] = rawContent;
        }
      }
    });
    res.json({ success: true, day, content, isAuthorized });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to read content' });
  }
});

// --- 管理后台接口 ---

app.post('/api/admin/generate-codes', async (req, res) => {
  const { key, count, durationDays } = req.body;
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  
  const finalCount = Math.min(parseInt(count) || 1, 200);
  const days = parseInt(durationDays) || 30;
  const batchId = `B${Date.now().toString().slice(-8)}`;

  try {
    const db = await dbPromise;
    await db.run('INSERT INTO code_batches (batch_id, count, duration_days) VALUES (?, ?, ?)', [batchId, finalCount, days]);
    
    for (let i = 0; i < finalCount; i++) {
      const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
      const code = `YW${days}-${randomStr}-${i.toString().padStart(3, '0')}`;
      await db.run('INSERT INTO activation_codes (code, duration_days, batch_id) VALUES (?, ?, ?)', [code, days, batchId]);
    }
    res.json({ success: true, batchId, count: finalCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate' });
  }
});

app.get('/api/admin/list-batches', async (req, res) => {
  const { key } = req.query;
  const db = await dbPromise;
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const batches = await db.all('SELECT * FROM code_batches ORDER BY created_at DESC LIMIT 20');
  res.json(batches);
});

app.get('/api/admin/list-codes', async (req, res) => {
  const { key, batchId } = req.query;
  const db = await dbPromise;
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const codes = await db.all('SELECT code, status, used_by, used_at FROM activation_codes WHERE batch_id = ?', [batchId]);
  res.json(codes);
});

app.listen(port, () => {
  console.log(`Chinese Daily Backend running at http://localhost:${port}`);
});

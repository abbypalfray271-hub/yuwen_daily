import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import DypnsapiModule from '@alicloud/dypnsapi20170525';
const Dypnsapi = (DypnsapiModule as any).default || DypnsapiModule;
import { SendSmsVerifyCodeRequest, CheckSmsVerifyCodeRequest } from '@alicloud/dypnsapi20170525';
import * as $OpenApi from '@alicloud/openapi-client';
import * as $Util from '@alicloud/tea-util';
import fs from 'fs';

// 自动探测 .env 位置
const envPath = path.join(process.cwd(), '.env');
dotenv.config({ path: envPath, override: true });

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 速率限制中间件
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  message: { error: '操作过于频繁，请稍后再试' }
});

const smsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, 
  max: 10, 
  message: { error: '短信发送过于频繁，请稍后再试' }
});

// 短信验证通过状态缓存
const verifiedPhones = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  for (const [phone, expiresAt] of verifiedPhones.entries()) {
    if (expiresAt < now) verifiedPhones.delete(phone);
  }
}, 60 * 1000);

// 阿里云号码认证服务客户端
function createPnsClient() {
  const config = new $OpenApi.Config({
    accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
  });
  config.endpoint = 'dypnsapi.aliyuncs.com';
  return new Dypnsapi(config);
}

const pnsClient = createPnsClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 数据源路径
const WIKI_PATH = path.resolve(__dirname, '../../wiki');
const UPLOADS_PATH = path.resolve(__dirname, '../uploads');
const LOCKS_PATH = path.resolve(__dirname, '../data/course_locks.json');

// 确保目录存在
if (!fs.existsSync(UPLOADS_PATH)) fs.mkdirSync(UPLOADS_PATH, { recursive: true });
if (!fs.existsSync(path.dirname(LOCKS_PATH))) fs.mkdirSync(path.dirname(LOCKS_PATH), { recursive: true });
if (!fs.existsSync(LOCKS_PATH)) fs.writeFileSync(LOCKS_PATH, JSON.stringify([]));

const getLockedDays = (): string[] => {
  try {
    const data = fs.readFileSync(LOCKS_PATH, 'utf-8');
    return JSON.parse(data || '[]');
  } catch (e) {
    return [];
  }
};
const saveLockedDays = (days: string[]) => {
  try {
    fs.writeFileSync(LOCKS_PATH, JSON.stringify(days));
  } catch (e) {
    console.error('Save locks failed:', e);
  }
};

app.use('/uploads', express.static(UPLOADS_PATH));

// 数据库初始化
const dbPath = path.resolve(__dirname, '../data/daily.db');
if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}
const db = new Database(dbPath);

// 初始化数据表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    contact TEXT PRIMARY KEY,
    nickname TEXT,
    grade INTEGER,
    pin TEXT,
    check_in_streak INTEGER DEFAULT 0,
    last_check_in_date TEXT,
    total_check_in_days INTEGER DEFAULT 0,
    mastered_tools TEXT DEFAULT '[]',
    expiry_at DATETIME,
    is_locked INTEGER DEFAULT 0,
    activated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS progress (
    contact TEXT,
    day_id TEXT,
    mastered_data TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (contact, day_id)
  );

  CREATE TABLE IF NOT EXISTS activation_codes (
    code TEXT PRIMARY KEY,
    duration_days INTEGER,
    batch_id TEXT,
    status INTEGER DEFAULT 0, -- 0:未使用, 1:已使用, -1:已作废
    used_by TEXT,
    used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_sync (
    contact TEXT PRIMARY KEY,
    sync_data TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS code_batches (
    batch_id TEXT PRIMARY KEY,
    count INTEGER,
    duration_days INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// --- 准入中间件 ---
const checkAccess = (req: any, res: any, next: any) => {
  const contact = req.body.contact || req.query.contact;
  if (!contact) return next();

  const user = db.prepare('SELECT expiry_at, is_locked FROM users WHERE contact = ?').get(contact) as any;
  if (user) {
    if (user.is_locked === 1) {
      return res.status(403).json({ error: 'FROZEN', message: '契约已被冻结，请咨询管理员' });
    }
    if (user.expiry_at && new Date(user.expiry_at) < new Date()) {
      return res.status(403).json({ error: 'EXPIRED', message: '契约时效已过，请寻求新的激活码' });
    }
  }
  next();
};

// --- API ---
app.get('/api/ping', (req, res) => res.json({ success: true, message: 'pong', version: '2.9.1' }));

app.post('/api/send-code', smsLimiter, async (req, res) => {
  const { phone } = req.body;
  if (process.env.VIP_PHONE && phone === process.env.VIP_PHONE) return res.json({ success: true });
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) return res.status(400).json({ error: '手机号格式不正确' });

  try {
    const request = new SendSmsVerifyCodeRequest({
      phoneNumber: phone,
      codeLength: 6,
      schemeName: process.env.SMS_SCHEME_NAME || '语文每日练',
      signName: process.env.SMS_SIGN_NAME || '速通互联验证码',
      templateCode: process.env.SMS_TEMPLATE_CODE || '100001',
      templateParam: JSON.stringify({ code: '##code##', min: '5' }),
    });
    const result = await pnsClient.sendSmsVerifyCodeWithOptions(request, new $Util.RuntimeOptions({}));
    if (result.body?.code !== 'OK') return res.status(500).json({ error: result.body?.message || '发送失败' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '短信发送失败' });
  }
});

app.post('/api/verify-code', apiLimiter, async (req, res) => {
  const { phone, code } = req.body;
  if (process.env.VIP_PHONE && phone === process.env.VIP_PHONE && code === process.env.VIP_CODE) {
    verifiedPhones.set(phone, Date.now() + 5 * 60 * 1000);
    return res.json({ verified: true });
  }
  try {
    const request = new CheckSmsVerifyCodeRequest({ phoneNumber: phone, verifyCode: code, schemeName: process.env.SMS_SCHEME_NAME || '语文每日练' });
    const result = await pnsClient.checkSmsVerifyCodeWithOptions(request, new $Util.RuntimeOptions({}));
    if (result.body?.code === 'OK' && result.body?.model?.verifyResult === 'PASS') {
      verifiedPhones.set(phone, Date.now() + 5 * 60 * 1000);
      res.json({ verified: true });
    } else {
      res.json({ verified: false, message: '验证码错误' });
    }
  } catch (err) {
    res.json({ verified: false, message: '验证失败' });
  }
});

app.post('/api/register', apiLimiter, async (req, res) => {
  const { nickname, grade, contact, pin, activationCode } = req.body;
  if (!nickname || !contact || !pin || !activationCode) return res.status(400).json({ error: '请填写完整信息' });

  const smsExpiresAt = verifiedPhones.get(contact);
  if (!smsExpiresAt || smsExpiresAt < Date.now()) return res.status(403).json({ error: '验证已失效' });

  let duration = 0;
  if (activationCode === 'DEFAULT_FREE') {
    duration = 36500;
  } else {
    const codeData = db.prepare('SELECT * FROM activation_codes WHERE code = ? AND status = 0').get(activationCode) as any;
    if (!codeData) return res.status(400).json({ error: '激活码无效' });
    duration = codeData.duration_days;
  }

  const hashedPin = await bcrypt.hash(pin, 10);
  const expiryAt = new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString();

  try {
    db.transaction(() => {
      db.prepare(`INSERT INTO users (contact, nickname, grade, pin, expiry_at) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(contact) DO UPDATE SET nickname=excluded.nickname, grade=excluded.grade, pin=excluded.pin, expiry_at=excluded.expiry_at`).run(contact, nickname, grade, hashedPin, expiryAt);
      if (activationCode !== 'DEFAULT_FREE') {
        db.prepare('UPDATE activation_codes SET status = 1, used_by = ?, used_at = CURRENT_TIMESTAMP WHERE code = ?').run(contact, activationCode);
      }
    })();
    verifiedPhones.delete(contact);
    res.json({ success: true, expiryAt });
  } catch (err) {
    res.status(500).json({ error: '注册失败' });
  }
});

app.post('/api/login', apiLimiter, checkAccess, async (req, res) => {
  const { contact, pin } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE contact = ?').get(user) as any; // ERROR in original flash_2? No, user = contact.
  const realUser = db.prepare('SELECT * FROM users WHERE contact = ?').get(contact) as any;
  if (!realUser) return res.status(404).json({ error: '用户不存在' });

  const match = await bcrypt.compare(pin, realUser.pin);
  if (!match) return res.status(401).json({ error: '口令错误' });

  const progressRows = db.prepare('SELECT * FROM progress WHERE contact = ?').all(contact) as any[];
  const progress: Record<string, any> = {};
  progressRows.forEach(row => progress[row.day_id] = JSON.parse(row.mastered_data));

  res.json({
    user: { nickname: realUser.nickname, grade: realUser.grade, contact: realUser.contact, expiryAt: realUser.expiry_at },
    progress
  });
});

app.post('/api/sync', checkAccess, (req, res) => {
  const { contact, stats, progress } = req.body;
  if (!contact) return res.status(400).json({ error: '未登录' });

  db.transaction(() => {
    if (stats) {
      db.prepare('UPDATE users SET check_in_streak=?, last_check_in_date=?, total_check_in_days=?, mastered_tools=? WHERE contact=?')
        .run(stats.checkInStreak || 0, stats.lastCheckInDate || '', stats.totalCheckInDays || 0, JSON.stringify(stats.masteredTools || []), contact);
    }
    if (progress) {
      const upsert = db.prepare('INSERT INTO progress (contact, day_id, mastered_data) VALUES (?, ?, ?) ON CONFLICT(contact, day_id) DO UPDATE SET mastered_data=excluded.mastered_data, updated_at=CURRENT_TIMESTAMP');
      for (const [dayId, data] of Object.entries(progress)) {
        upsert.run(contact, dayId, JSON.stringify(data));
      }
    }
  })();
  res.json({ success: true });
});

// --- 课件接口 (带鉴权) ---
app.get('/api/courseware/list', async (req, res) => {
  if (!fs.existsSync(WIKI_PATH)) return res.json({ success: true, days: [] });
  
  const daySet = new Set<string>();
  const scanDir = (dir: string) => {
    const items = fs.readdirSync(dir);
    items.forEach(item => {
      const fullPath = path.join(dir, item);
      if (fs.statSync(fullPath).isDirectory()) {
        scanDir(fullPath);
      } else {
        const match = item.match(/Day(\d+)_/);
        if (match) daySet.add(match[1]);
      }
    });
  };
  
  scanDir(WIKI_PATH);
  res.json({ 
    success: true, 
    days: Array.from(daySet).sort((a, b) => parseInt(a) - parseInt(b)),
    lockedDays: getLockedDays()
  });
});

app.get('/api/courseware/get', checkAccess, async (req, res) => {
  const { day, contact } = req.query;
  if (!day) return res.status(400).json({ success: false, message: 'Missing day' });

  const user = db.prepare('SELECT contact FROM users WHERE contact = ?').get(contact);
  const isAuthorized = !!user;

  try {
    const content: Record<string, string> = {};
    const scanAndRead = (dir: string) => {
      const items = fs.readdirSync(dir);
      items.forEach(item => {
        const fullPath = path.join(dir, item);
        if (fs.statSync(fullPath).isDirectory()) {
          scanAndRead(fullPath);
        } else if (item.startsWith(`Day${day}_`)) {
          const typeMatch = item.match(/_(\d+)_(.+)\.md/);
          if (typeMatch) {
            const typeKey = typeMatch[2];
            const rawContent = fs.readFileSync(fullPath, 'utf-8');
            content[typeKey] = (!isAuthorized && (typeKey === 'practice' || typeKey === 'review')) 
              ? '> [!CAUTION]\n> **内容已锁定**\n> 请完成契约登入以解锁。' 
              : rawContent;
          }
        }
      });
    };

    scanAndRead(WIKI_PATH);
    res.json({ success: true, day, content, isAuthorized });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to read' });
  }
});

app.post('/api/sync', checkAccess, (req, res) => {
  const { contact, syncData } = req.body;
  if (!contact || !syncData) return res.status(400).json({ error: 'Missing data' });
  try {
    db.prepare('INSERT OR REPLACE INTO user_sync (contact, sync_data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(contact, JSON.stringify(syncData));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Sync failed' });
  }
});

// --- 管理后台 ---
app.post('/api/admin/generate-codes', (req, res) => {
  const { key, count, durationDays } = req.body;
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const finalCount = Math.min(parseInt(count) || 1, 200);
  const days = parseInt(durationDays) || 30;
  const batchId = `B${Date.now().toString().slice(-8)}`;
  db.transaction(() => {
    db.prepare('INSERT INTO code_batches (batch_id, count, duration_days) VALUES (?, ?, ?)').run(batchId, finalCount, days);
    for (let i = 0; i < finalCount; i++) {
      const code = `YW${days}-${Math.random().toString(36).substring(2, 8).toUpperCase()}-${i.toString().padStart(3, '0')}`;
      db.prepare('INSERT INTO activation_codes (code, duration_days, batch_id) VALUES (?, ?, ?)').run(code, days, batchId);
    }
  })();
  res.json({ success: true, batchId, count: finalCount });
});

app.get('/api/admin/list-codes', (req, res) => {
  const { key, batchId } = req.query;
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  if (!batchId) return res.status(400).json({ error: 'Missing batchId' });
  const codes = db.prepare('SELECT code, duration_days, status, used_by, used_at FROM activation_codes WHERE batch_id = ?').all(batchId);
  res.json(codes);
});

app.get('/api/admin/export-progress', (req, res) => {
  const { key } = req.query;
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const allProgress = db.prepare(`
    SELECT users.nickname, users.contact, user_sync.sync_data, user_sync.updated_at 
    FROM users 
    LEFT JOIN user_sync ON users.contact = user_sync.contact
  `).all();
  res.json(allProgress);
});

app.post('/api/upload', checkAccess, (req, res) => {
  const { image, day, contact } = req.body;
  if (!image || !day || !contact) return res.status(400).json({ error: 'Missing data' });

  try {
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');
    const fileName = `${contact}_${day}_${Date.now()}.jpg`;
    fs.writeFileSync(path.join(UPLOADS_PATH, fileName), buffer);
    res.json({ success: true, fileName });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.post('/api/admin/toggle-lock', checkAccess, (req, res) => {
  const { day, locked } = req.body;
  if (!day) return res.status(400).json({ error: 'Missing day' });

  try {
    let lockedDays = getLockedDays();
    if (locked) {
      if (!lockedDays.includes(day)) lockedDays.push(day);
    } else {
      lockedDays = lockedDays.filter(d => d !== day);
    }
    saveLockedDays(lockedDays);
    res.json({ success: true, lockedDays });
  } catch (err) {
    res.status(500).json({ error: 'Server lock update failed' });
  }
});

app.listen(process.env.PORT || 3005, () => console.log('Backend running...'));

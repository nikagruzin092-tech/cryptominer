const express = require("express");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const ADS_BLOCK_ID = process.env.ADS_BLOCK_ID || "47862";

const db = new Database(path.join(__dirname, "data.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY,
  username TEXT DEFAULT '',
  first_name TEXT DEFAULT '',
  balance INTEGER DEFAULT 0,
  energy INTEGER DEFAULT 100,
  max_energy INTEGER DEFAULT 100,
  power INTEGER DEFAULT 1,
  upgrade_level INTEGER DEFAULT 0,
  last_mine INTEGER DEFAULT 0,
  last_daily TEXT DEFAULT '',
  referrer_id TEXT DEFAULT '',
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  wallet TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
`);

app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

function parseInitData(initData) {
  if (!initData) throw new Error("Telegram initData отсутствует");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("Telegram hash отсутствует");

  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key !== "hash") pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const expected = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) {
    throw new Error("Неверная подпись Telegram initData");
  }

  const userRaw = params.get("user");
  if (!userRaw) throw new Error("Telegram user отсутствует");

  return JSON.parse(userRaw);
}

function auth(req, res, next) {
  try {
    if (!BOT_TOKEN) return res.status(500).json({ error: "BOT_TOKEN не настроен" });
    const initData = req.get("X-Telegram-Init-Data") || req.body?.initData;
    const user = parseInitData(initData);
    req.tgUser = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: e.message });
  }
}

function getOrCreateUser(tg) {
  let user = db.prepare("SELECT * FROM users WHERE telegram_id=?").get(String(tg.id));
  if (!user) {
    db.prepare(`
      INSERT INTO users (telegram_id, username, first_name)
      VALUES (?, ?, ?)
    `).run(String(tg.id), tg.username || "", tg.first_name || "");
    user = db.prepare("SELECT * FROM users WHERE telegram_id=?").get(String(tg.id));
  }
  return user;
}

function publicState(user) {
  return {
    telegramId: user.telegram_id,
    username: user.username,
    firstName: user.first_name,
    balance: user.balance,
    energy: user.energy,
    maxEnergy: user.max_energy,
    power: user.power,
    upgradeLevel: user.upgrade_level,
    lastDaily: user.last_daily,
    adsBlockId: ADS_BLOCK_ID
  };
}

// Health endpoint for Railway.
app.get("/health", (_req, res) => res.json({ ok: true }));

// The Mini App shell can be opened by Telegram; API calls require verified initData.
app.get("/api/state", auth, (req, res) => {
  const user = getOrCreateUser(req.tgUser);
  res.json(publicState(user));
});

app.post("/api/mine", auth, (req, res) => {
  const user = getOrCreateUser(req.tgUser);
  const now = Date.now();
  const cooldown = 350;
  if (now - Number(user.last_mine || 0) < cooldown) {
    return res.status(429).json({ error: "Слишком часто" });
  }
  if (user.energy <= 0) return res.status(400).json({ error: "Нет энергии" });

  const gain = Math.max(1, user.power);
  db.prepare(`
    UPDATE users SET balance=balance+?, energy=energy-1, last_mine=? WHERE telegram_id=?
  `).run(gain, now, user.telegram_id);

  res.json(publicState(getOrCreateUser(req.tgUser)));
});

app.post("/api/upgrade", auth, (req, res) => {
  const user = getOrCreateUser(req.tgUser);
  const cost = Math.floor(100 * Math.pow(1.8, user.upgrade_level));
  if (user.balance < cost) return res.status(400).json({ error: `Нужно ${cost}` });

  db.prepare(`
    UPDATE users SET balance=balance-?, power=power+1, upgrade_level=upgrade_level+1
    WHERE telegram_id=?
  `).run(cost, user.telegram_id);

  res.json(publicState(getOrCreateUser(req.tgUser)));
});

app.post("/api/boost", auth, (req, res) => {
  const user = getOrCreateUser(req.tgUser);
  db.prepare("UPDATE users SET energy=max_energy WHERE telegram_id=?").run(user.telegram_id);
  res.json(publicState(getOrCreateUser(req.tgUser)));
});

app.post("/api/daily", auth, (req, res) => {
  const user = getOrCreateUser(req.tgUser);
  const day = new Date().toISOString().slice(0, 10);
  if (user.last_daily === day) return res.status(400).json({ error: "Бонус уже получен" });

  db.prepare("UPDATE users SET balance=balance+1000,last_daily=? WHERE telegram_id=?")
    .run(day, user.telegram_id);
  res.json(publicState(getOrCreateUser(req.tgUser)));
});

app.post("/api/ad-reward", auth, (req, res) => {
  const user = getOrCreateUser(req.tgUser);
  // Reward is granted only after the client reports a completed Rewarded ad.
  // For production AdsGram anti-fraud verification, add the provider callback here.
  db.prepare("UPDATE users SET balance=balance+50 WHERE telegram_id=?").run(user.telegram_id);
  res.json(publicState(getOrCreateUser(req.tgUser)));
});

app.post("/api/withdraw", auth, (req, res) => {
  const user = getOrCreateUser(req.tgUser);
  const amount = Number(req.body?.amount);
  const wallet = String(req.body?.wallet || "").trim();

  if (!Number.isInteger(amount) || amount < 150000) {
    return res.status(400).json({ error: "Минимальная сумма вывода: 150000" });
  }
  if (!wallet) return res.status(400).json({ error: "Укажите TON-кошелёк" });
  if (user.balance < amount) return res.status(400).json({ error: "Недостаточно средств" });

  db.prepare("UPDATE users SET balance=balance-? WHERE telegram_id=?")
    .run(amount, user.telegram_id);

  const result = db.prepare(`
    INSERT INTO withdrawals (telegram_id, amount, wallet) VALUES (?, ?, ?)
  `).run(user.telegram_id, amount, wallet);

  res.json({ ok: true, withdrawalId: result.lastInsertRowid,
    state: publicState(getOrCreateUser(req.tgUser)) });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TON Falcon server listening on 0.0.0.0:${PORT}`);
  console.log(`AdsGram block: ${ADS_BLOCK_ID}`);
});

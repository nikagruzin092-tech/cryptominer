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

/* =========================
   MINI APP FILES
========================= */

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/index.html", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/style.css", (_req, res) => {
  res.sendFile(path.join(__dirname, "style.css"));
});

app.get("/app.js", (_req, res) => {
  res.sendFile(path.join(__dirname, "app.js"));
});

/* =========================
   HEALTH
========================= */

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    server: "TON Falcon",
    adsBlockId: ADS_BLOCK_ID
  });
});

/* =========================
   TELEGRAM AUTH
========================= */

function parseInitData(initData) {
  if (!initData) {
    throw new Error("Telegram initData отсутствует");
  }

  if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN не настроен");
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) {
    throw new Error("Telegram hash отсутствует");
  }

  const pairs = [];

  for (const [key, value] of params.entries()) {
    if (key !== "hash") {
      pairs.push(`${key}=${value}`);
    }
  }

  pairs.sort();

  const dataCheckString = pairs.join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const expectedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (expectedHash.length !== hash.length) {
    throw new Error("Неверная подпись Telegram");
  }

  if (
    !crypto.timingSafeEqual(
      Buffer.from(expectedHash),
      Buffer.from(hash)
    )
  ) {
    throw new Error("Неверная подпись Telegram initData");
  }

  const userRaw = params.get("user");

  if (!userRaw) {
    throw new Error("Telegram user отсутствует");
  }

  return JSON.parse(userRaw);
}

/* =========================
   AUTH MIDDLEWARE
========================= */

function auth(req, res, next) {
  try {
    const initData =
      req.get("X-Telegram-Init-Data") ||
      req.body?.initData ||
      "";

    const user = parseInitData(initData);

    req.tgUser = user;

    next();
  } catch (error) {
    console.error("AUTH ERROR:", error.message);

    return res.status(401).json({
      ok: false,
      error: error.message
    });
  }
}

/* =========================
   USER
========================= */

function getOrCreateUser(tg) {
  const telegramId = String(tg.id);

  let user = db
    .prepare(
      "SELECT * FROM users WHERE telegram_id = ?"
    )
    .get(telegramId);

  if (!user) {
    db.prepare(`
      INSERT INTO users
      (
        telegram_id,
        username,
        first_name
      )
      VALUES (?, ?, ?)
    `).run(
      telegramId,
      tg.username || "",
      tg.first_name || ""
    );

    user = db
      .prepare(
        "SELECT * FROM users WHERE telegram_id = ?"
      )
      .get(telegramId);
  }

  return user;
}

/* =========================
   PUBLIC STATE
========================= */

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

/* =========================
   STATE
========================= */

app.get("/api/state", auth, (req, res) => {
  try {
    const user = getOrCreateUser(req.tgUser);

    res.json({
      ok: true,
      state: publicState(user)
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      error: "Ошибка сервера"
    });
  }
});

/* =========================
   MINE
========================= */

app.post("/api/mine", auth, (req, res) => {
  try {
    const user = getOrCreateUser(req.tgUser);

    const now = Date.now();
    const cooldown = 350;

    if (
      now - Number(user.last_mine || 0) <
      cooldown
    ) {
      return res.status(429).json({
        ok: false,
        error: "Слишком часто"
      });
    }

    if (user.energy <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Нет энергии"
      });
    }

    const gain = Math.max(
      1,
      Number(user.power || 1)
    );

    db.prepare(`
      UPDATE users

      SET
        balance = balance + ?,
        energy = energy - 1,
        last_mine = ?

      WHERE telegram_id = ?
    `).run(
      gain,
      now,
      user.telegram_id
    );

    const updated =
      getOrCreateUser(req.tgUser);

    res.json({
      ok: true,
      state: publicState(updated)
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      error: "Ошибка сервера"
    });
  }
});

/* =========================
   UPGRADE
========================= */

app.post("/api/upgrade", auth, (req, res) => {
  try {
    const user = getOrCreateUser(req.tgUser);

    const cost = Math.floor(
      100 *
      Math.pow(
        1.8,
        Number(user.upgrade_level || 0)
      )
    );

    if (user.balance < cost) {
      return res.status(400).json({
        ok: false,
        error: `Нужно ${cost}`
      });
    }

    db.prepare(`
      UPDATE users

      SET
        balance = balance - ?,
        power = power + 1,
        upgrade_level = upgrade_level + 1

      WHERE telegram_id = ?
    `).run(
      cost,
      user.telegram_id
    );

    const updated =
      getOrCreateUser(req.tgUser);

    res.json({
      ok: true,
      state: publicState(updated)
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      error: "Ошибка сервера"
    });
  }
});

/* =========================
   BOOST
========================= */

app.post("/api/boost", auth, (req, res) => {
  try {
    const user = getOrCreateUser(req.tgUser);

    db.prepare(`
      UPDATE users
      SET energy = max_energy
      WHERE telegram_id = ?
    `).run(user.telegram_id);

    const updated =
      getOrCreateUser(req.tgUser);

    res.json({
      ok: true,
      state: publicState(updated)
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      error: "Ошибка сервера"
    });
  }
});

/* =========================
   DAILY
========================= */

app.post("/api/daily", auth, (req, res) => {
  try {
    const user = getOrCreateUser(req.tgUser);

    const day = new Date()
      .toISOString()
      .slice(0, 10);

    if (user.last_daily === day) {
      return res.status(400).json({
        ok: false,
        error: "Бонус уже получен"
      });
    }

    db.prepare(`
      UPDATE users

      SET
        balance = balance + 1000,
        last_daily = ?

      WHERE telegram_id = ?
    `).run(
      day,
      user.telegram_id
    );

    const updated =
      getOrCreateUser(req.tgUser);

    res.json({
      ok: true,
      state: publicState(updated)
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      error: "Ошибка сервера"
    });
  }
});

/* =========================
   ADSGRAM REWARD
========================= */

app.post("/api/ad-reward", auth, (req, res) => {
  try {
    const user = getOrCreateUser(req.tgUser);

    db.prepare(`
      UPDATE users

      SET balance = balance + 50

      WHERE telegram_id = ?
    `).run(user.telegram_id);

    const updated =
      getOrCreateUser(req.tgUser);

    res.json({
      ok: true,
      reward: 50,
      state: publicState(updated)
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      error: "Ошибка сервера"
    });
  }
});

/* =========================
   WITHDRAW
========================= */

app.post("/api/withdraw", auth, (req, res) => {
  try {
    const user = getOrCreateUser(req.tgUser);

    const amount = Number(
      req.body?.amount
    );

    const wallet = String(
      req.body?.wallet || ""
    ).trim();

    if (
      !Number.isInteger(amount) ||
      amount < 150000
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Минимальная сумма вывода: 150000"
      });
    }

    if (!wallet) {
      return res.status(400).json({
        ok: false,
        error:
          "Укажите TON-кошелёк"
      });
    }

    if (user.balance < amount) {
      return res.status(400).json({
        ok: false,
        error:
          "Недостаточно средств"
      });
    }

    db.prepare(`
      UPDATE users

      SET balance = balance - ?

      WHERE telegram_id = ?
    `).run(
      amount,
      user.telegram_id
    );

    const result = db.prepare(`
      INSERT INTO withdrawals
      (
        telegram_id,
        amount,
        wallet
      )

      VALUES (?, ?, ?)
    `).run(
      user.telegram_id,
      amount,
      wallet
    );

    const updated =
      getOrCreateUser(req.tgUser);

    res.json({
      ok: true,

      withdrawalId:
        result.lastInsertRowid,

      state:
        publicState(updated)
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      error: "Ошибка сервера"
    });
  }
});

/* =========================
   404
========================= */

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Страница не найдена",
    path: req.path
  });
});

/* =========================
   START
========================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `TON Falcon server listening on 0.0.0.0:${PORT}`
    );

    console.log(
      `AdsGram block: ${ADS_BLOCK_ID}`
    );
  }
);

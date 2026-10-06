const express = require("express");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const BOT_USERNAME =
  process.env.BOT_USERNAME || "my_crypto_miner_game_bot";
const ADS_BLOCK_ID =
  process.env.ADS_BLOCK_ID || "52244";

app.use(express.json({ limit: "100kb" }));

app.use((q, r, n) => {
  r.header("Access-Control-Allow-Origin", "*");
  r.header(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
  );
  r.header(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Telegram-Init-Data"
  );

  if (q.method === "OPTIONS") {
    return r.sendStatus(204);
  }

  n();
});

const db = new Database(
  path.join(__dirname, "falcon.db")
);

db.pragma("journal_mode=WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  username TEXT DEFAULT '',
  balance INTEGER DEFAULT 0,
  energy INTEGER DEFAULT 1500,
  max_energy INTEGER DEFAULT 1500,
  power INTEGER DEFAULT 1,
  passive_per_minute INTEGER DEFAULT 0,
  regen INTEGER DEFAULT 12,
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  last_mine INTEGER DEFAULT 0,
  last_energy_update INTEGER DEFAULT 0,
  last_daily INTEGER DEFAULT 0,
  streak INTEGER DEFAULT 0,
  total_mined INTEGER DEFAULT 0,
  ad_views INTEGER DEFAULT 0,
  completed_contracts INTEGER DEFAULT 0,
  referral_count INTEGER DEFAULT 0,
  referred_by INTEGER,
  created_at INTEGER DEFAULT 0,
  updated_at INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS withdrawals(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount INTEGER,
  wallet TEXT,
  status TEXT DEFAULT 'pending',
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS transactions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount INTEGER,
  label TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS contracts(
  user_id INTEGER,
  contract_id TEXT,
  progress INTEGER DEFAULT 0,
  claimed INTEGER DEFAULT 0,
  PRIMARY KEY(user_id, contract_id)
);
`);

function col(name, type, def) {
  const exists = db
    .prepare("PRAGMA table_info(users)")
    .all()
    .some(x => x.name === name);

  if (!exists) {
    db.exec(
      `ALTER TABLE users ADD COLUMN ${name} ${type} DEFAULT ${def}`
    );
  }
}

const defs = {
  username: ["TEXT", "''"],
  max_energy: ["INTEGER", "1500"],
  passive_per_minute: ["INTEGER", "0"],
  regen: ["INTEGER", "12"],
  level: ["INTEGER", "1"],
  xp: ["INTEGER", "0"],
  last_mine: ["INTEGER", "0"],
  last_energy_update: ["INTEGER", "0"],
  last_daily: ["INTEGER", "0"],
  streak: ["INTEGER", "0"],
  total_mined: ["INTEGER", "0"],
  ad_views: ["INTEGER", "0"],
  completed_contracts: ["INTEGER", "0"],
  referral_count: ["INTEGER", "0"],
  referred_by: ["INTEGER", "NULL"],
  created_at: ["INTEGER", "0"],
  updated_at: ["INTEGER", "0"]
};

Object.keys(defs).forEach(x => {
  col(x, ...defs[x]);
});

/* =========================
   TIME
========================= */

const now = () =>
  Math.floor(Date.now() / 1000);

const xpNext = level =>
  100 + (level - 1) * 75;

/* =========================
   TELEGRAM AUTH
========================= */

function auth(req) {
  const initData =
    req.header("X-Telegram-Init-Data");

  if (!initData || !BOT_TOKEN) {
    throw Error(
      "Telegram авторизация не настроена."
    );
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  let dataCheckArr = [];

  for (const [key, value] of params) {
    if (key !== "hash") {
      dataCheckArr.push(
        key + "=" + value
      );
    }
  }

  dataCheckArr.sort();

  const secretKey = crypto
    .createHmac(
      "sha256",
      "WebAppData"
    )
    .update(BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac(
      "sha256",
      secretKey
    )
    .update(dataCheckArr.join("\n"))
    .digest("hex");

  if (!hash || calculatedHash !== hash) {
    throw Error(
      "Недействительная Telegram-сессия."
    );
  }

  const authDate =
    Number(params.get("auth_date") || 0);

  if (now() - authDate > 86400) {
    throw Error(
      "Telegram-сессия устарела."
    );
  }

  const telegramUser =
    JSON.parse(
      params.get("user") || "{}"
    );

  if (!telegramUser.id) {
    throw Error(
      "Не найден Telegram user ID."
    );
  }

  return telegramUser;
}

/* =========================
   USER
========================= */

function user(telegramUser) {
  let u = db
    .prepare(
      "SELECT * FROM users WHERE id=?"
    )
    .get(telegramUser.id);

  if (!u) {
    const current = now();

    db.prepare(`
      INSERT INTO users(
        id,
        username,
        created_at,
        updated_at,
        last_energy_update
      )
      VALUES(?,?,?,?,?)
    `).run(
      telegramUser.id,
      telegramUser.username ||
        telegramUser.first_name ||
        "",
      current,
      current,
      current
    );

    u = db
      .prepare(
        "SELECT * FROM users WHERE id=?"
      )
      .get(telegramUser.id);
  }

  return u;
}

/* =========================
   ENERGY
========================= */

function energy(u) {
  const seconds = Math.max(
    0,
    now() - u.last_energy_update
  );

  const newEnergy = Math.min(
    u.max_energy,
    u.energy + seconds * u.regen
  );

  if (seconds > 0) {
    db.prepare(`
      UPDATE users
      SET energy=?,
          last_energy_update=?
      WHERE id=?
    `).run(
      newEnergy,
      now(),
      u.id
    );
  }

  u.energy = newEnergy;

  return u;
}

/* =========================
   TRANSACTIONS
========================= */

function tx(userId, amount, label) {
  db.prepare(`
    INSERT INTO transactions(
      user_id,
      amount,
      label,
      created_at
    )
    VALUES(?,?,?,?)
  `).run(
    userId,
    amount,
    label,
    now()
  );
}

/* =========================
   XP
========================= */

function addXP(userId, amount) {
  const u = db
    .prepare(
      "SELECT level,xp FROM users WHERE id=?"
    )
    .get(userId);

  let xp = u.xp + amount;
  let level = u.level;

  while (
    xp >= xpNext(level)
  ) {
    xp -= xpNext(level);
    level++;
  }

  db.prepare(`
    UPDATE users
    SET xp=?,
        level=?
    WHERE id=?
  `).run(
    xp,
    level,
    userId
  );
}

/* =========================
   CONTRACTS
========================= */

function contracts(u) {
  const data = [
    [
      "mine100",
      "Первая сотня",
      "Сделай 100 добывающих действий.",
      100,
      100
    ],
    [
      "mine1000",
      "Разведка сектора",
      "Добыть 1 000 TONF.",
      1000,
      500
    ],
    [
      "upgrade2",
      "Инженерный старт",
      "Купить 2 улучшения.",
      2,
      700
    ],
    [
      "daily3",
      "Три дня связи",
      "Получить 3 ежедневных бонуса.",
      3,
      900
    ]
  ];

  return data.map(x => {
    const record = db
      .prepare(`
        SELECT *
        FROM contracts
        WHERE user_id=?
        AND contract_id=?
      `)
      .get(
        u.id,
        x[0]
      );

    let progress = 0;

    if (
      x[0] === "mine100" ||
      x[0] === "mine1000"
    ) {
      progress = Math.min(
        x[3],
        u.total_mined
      );
    }

    if (x[

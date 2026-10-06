const express = require("express");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const BOT_USERNAME =
  process.env.BOT_USERNAME || "my_crypto_miner_game_bot";
const ADS_BLOCK_ID = process.env.ADS_BLOCK_ID || "52244";

app.use(express.json({ limit: "100kb" }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Telegram-Init-Data"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
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

function ensureColumn(name, type, def) {
  const exists = db
    .prepare("PRAGMA table_info(users)")
    .all()
    .some((c) => c.name === name);

  if (!exists) {
    db.exec(
      `ALTER TABLE users ADD COLUMN ${name} ${type} DEFAULT ${def}`
    );
  }
}

const columns = {
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

for (const [name, def] of Object.entries(columns)) {
  ensureColumn(name, def[0], def[1]);
}

const now = () => Math.floor(Date.now() / 1000);

const xpNext = (level) =>
  100 + (level - 1) * 75;

function auth(req) {
  const initData =
    req.header("X-Telegram-Init-Data");

  if (!initData || !BOT_TOKEN) {
    throw new Error(
      "Telegram авторизация не настроена."
    );
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  const data = [];

  for (const [key, value] of params) {
    if (key !== "hash") {
      data.push(`${key}=${value}`);
    }
  }

  data.sort();

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secret)
    .update(data.join("\n"))
    .digest("hex");

  if (!hash || calculatedHash !== hash) {
    throw new Error(
      "Недействительная Telegram-сессия."
    );
  }

  const authDate = Number(
    params.get("auth_date") || 0
  );

  if (now() - authDate > 86400) {
    throw new Error(
      "Telegram-сессия устарела."
    );
  }

  let tgUser;

  try {
    tgUser = JSON.parse(
      params.get("user") || "{}"
    );
  } catch {
    throw new Error(
      "Некорректные данные Telegram."
    );
  }

  if (!tgUser.id) {
    throw new Error(
      "Не найден Telegram user ID."
    );
  }

  return tgUser;
}

function getUser(tgUser) {
  let user = db
    .prepare(
      "SELECT * FROM users WHERE id=?"
    )
    .get(tgUser.id);

  if (!user) {
    const timestamp = now();

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
      tgUser.id,
      tgUser.username ||
        tgUser.first_name ||
        "",
      timestamp,
      timestamp,
      timestamp
    );

    user = db
      .prepare(
        "SELECT * FROM users WHERE id=?"
      )
      .get(tgUser.id);
  }

  return user;
}

function updateEnergy(user) {
  const timestamp = now();

  const elapsed = Math.max(
    0,
    timestamp -
      Number(
        user.last_energy_update ||
          timestamp
      )
  );

  const energy = Math.min(
    user.max_energy,
    user.energy +
      elapsed * user.regen
  );

  if (elapsed > 0) {
    db.prepare(`
      UPDATE users
      SET
        energy=?,
        last_energy_update=?,
        updated_at=?
      WHERE id=?
    `).run(
      energy,
      timestamp,
      timestamp,
      user.id
    );
  }

  user.energy = energy;
  user.last_energy_update = timestamp;

  return user;
}

function addTransaction(
  userId,
  amount,
  label
) {
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

function addXp(userId, amount) {
  const user = db
    .prepare(
      "SELECT level,xp FROM users WHERE id=?"
    )
    .get(userId);

  let xp = user.xp + amount;
  let level = user.level;

  while (xp >= xpNext(level)) {
    xp -= xpNext(level);
    level++;
  }

  db.prepare(`
    UPDATE users
    SET
      xp=?,
      level=?,
      updated_at=?
    WHERE id=?
  `).run(
    xp,
    level,
    now(),
    userId
  );
}

function getContracts(user) {
  const list = [
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

  return list.map((item) => {
    const saved = db
      .prepare(`
        SELECT *
        FROM contracts
        WHERE user_id=?
        AND contract_id=?
      `)
      .get(
        user.id,
        item[0]
      );

    let progress = 0;

    if (
      item[0] === "mine100" ||
      item[0] === "mine1000"
    ) {
      progress = Math.min(
        item[3],
        user.total_mined
      );
    }

    if (item[0] === "upgrade2") {
      progress = Math.min(
        2,
        Math.max(
          0,
          user.power - 1
        )
      );
    }

    if (item[0] === "daily3") {
      progress = Math.min(
        3,
        Math.max(
          0,
          user.streak
        )
      );
    }

    return {
      id: item[0],
      title: item[1],
      description: item[2],
      target: item[3],
      reward: item[4],
      progress,
      completed:
        !!saved?.claimed,
      claimable:
        progress >= item[3] &&
        !saved?.claimed
    };
  });
}

function getState(user) {
  user = updateEnergy(user);

  user = db
    .prepare(
      "SELECT * FROM users WHERE id=?"
    )
    .get(user.id);

  return {
    balance: user.balance,
    energy: user.energy,
    maxEnergy: user.max_energy,
    power: user.power,
    passivePerMinute:
      user.passive_per_minute,
    level: user.level,
    xp: user.xp,
    nextXp: xpNext(user.level),
    streak: user.streak,
    referrals: user.referral_count,

    dailyAvailable:
      now() -
        user.last_daily >=
      86400,

    referralLink:
      `https://t.me/${BOT_USERNAME}?start=ref_${user.id}`,

    adsBlockId: ADS_BLOCK_ID,

    upgrades: {
      power: {
        cost: Math.floor(
          100 *
            Math.pow(
              1.65,
              Math.max(
                0,
                user.power - 1
              )
            )
        )
      },

      energy: {
        cost: Math.floor(
          250 *
            Math.pow(
              1.7,
              Math.max(
                0,
                (user.max_energy -
                  1500) /
                  250
              )
            )
        )
      },

      regen: {
        cost: Math.floor(
          400 *
            Math.pow(
              1.75,
              Math.max(
                0,
                (user.regen - 12) /
                  4
              )
            )
        )
      }
    },

    history: db
      .prepare(`
        SELECT amount,label
        FROM transactions
        WHERE user_id=?
        ORDER BY id DESC
        LIMIT 20
      `)
      .all(user.id),

    contracts:
      getContracts(user),

    stats: {
      totalMined:
        user.total_mined,

      adViews:
        user.ad_views,

      completedContracts:
        user.completed_contracts
    }
  };
}

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,
      server: "TON Falcon",
      adsBlockId: ADS_BLOCK_ID
    });
  }
);

app.use(
  express.static(__dirname)
);

app.get(
  "/",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );
  }
);

app.get(
  "/api/state",
  (req, res) => {
    try {
      const tgUser = auth(req);
      const user = getUser(tgUser);

      res.json({
        state: getState(user)
      });
    } catch (error) {
      res
        .status(401)
        .json({
          error: error.message
        });
    }
  }
);

/*
==================================================
                    МАЙНИНГ
==================================================

ВАЖНО:

Раньше здесь использовался now(), который
возвращает секунды.

Из-за этого несколько быстрых кликов
в течение одной секунды считались одинаковыми.

Теперь last_mine хранит миллисекунды.

Минимальный интервал = 50 мс.

Обычный пользователь физически сможет
нажимать очень быстро.

==================================================
*/

app.post(
  "/api/mine",
  (req, res) => {
    try {
      const tgUser = auth(req);
      const user =
        updateEnergy(
          getUser(tgUser)
        );

      const mineTime =
        Date.now();

      const previousMine =
        Number(
          user.last_mine || 0
        );

      /*
       * Старые значения last_mine были
       * в секундах.

       * Если значение старого формата —
       * просто игнорируем его.
       */
      const previousIsMilliseconds =
        previousMine > 100000000000;

      /*
       * Очень маленькая защита от
       * автоматического спама.
       *
       * 50 миллисекунд.
       */
      if (
        previousIsMilliseconds &&
        mineTime - previousMine < 50
      ) {
        return res.json({
          state: getState(
            getUser(tgUser)
          )
        });
      }

      if (
        user.energy <
        user.power
      ) {
        throw new Error(
          "Недостаточно энергии."
        );
      }

      db.prepare(`
        UPDATE users
        SET
          balance=balance+?,
          energy=energy-?,
          last_mine=?,
          total_mined=total_mined+?,
          updated_at=?
        WHERE id=?
      `).run(
        user.power,
        user.power,
        mineTime,
        user.power,
        now(),
        tgUser.id
      );

      addTransaction(
        tgUser.id,
        user.power,
        "Майнинг"
      );

      addXp(
        tgUser.id,
        1
      );

      res.json({
        state: getState(
          getUser(tgUser)
        )
      });

    } catch (error) {
      res
        .status(400)
        .json({
          error: error.message
        });
    }
  }
);

app.post(
  "/api/upgrade",
  (req, res) => {
    try {
      const tgUser = auth(req);

      const user =
        updateEnergy(
          getUser(tgUser)
        );

      const type =
        req.body?.type;

      let cost;
      let sql;
      let label;

      if (type === "power") {
        cost = Math.floor(
          100 *
            Math.pow(
              1.65,
              Math.max(
                0,
                user.power - 1
              )
            )
        );

        sql = `
          UPDATE users
          SET
            balance=balance-?,
            power=power+1,
            passive_per_minute=
              passive_per_minute+5,
            updated_at=?
          WHERE id=?
        `;

        label = "Mining Core";

      } else if (
        type === "energy"
      ) {
        cost = Math.floor(
          250 *
            Math.pow(
              1.7,
              Math.max(
                0,
                (user.max_energy -
                  1500) /
                  250
              )
            )
        );

        sql = `
          UPDATE users
          SET
            balance=balance-?,
            max_energy=max_energy+250,
            energy=energy+250,
            updated_at=?
          WHERE id=?
        `;

        label = "Energy Cell";

      } else if (
        type === "regen"
      ) {
        cost = Math.floor(
          400 *
            Math.pow(
              1.75,
              Math.max(
                0,
                (user.regen - 12) /
                  4
              )
            )
        );

        sql = `
          UPDATE users
          SET
            balance=balance-?,
            regen=regen+4,
            updated_at=?
          WHERE id=?
        `;

        label = "Cooler";

      } else {
        throw new Error(
          "Неизвестное улучшение."
        );
      }

      if (
        user.balance <
        cost
      ) {
        throw new Error(
          "Недостаточно TONF."
        );
      }

      db.prepare(sql).run(
        cost,
        now(),
        tgUser.id
      );

      addTransaction(
        tgUser.id,
        -cost,
        "Улучшение " + label
      );

      addXp(
        tgUser.id,
        10
      );

      res.json({
        state: getState(
          getUser(tgUser)
        )
      });

    } catch (error) {
      res
        .status(400)
        .json({
          error: error.message
        });
    }
  }
);

app.post(
  "/api/daily",
  (req, res) => {
    try {
      const tgUser = auth(req);
      const user =
        getUser(tgUser);

      const timestamp = now();

      if (
        timestamp -
          user.last_daily <
        86400
      ) {
        throw new Error(
          "Ежедневный бонус уже получен."
        );
      }

      const streak =
        user.last_daily &&
        timestamp -
          user.last_daily <
          172800
          ? user.streak + 1
          : 1;

      const reward =
        250 +
        Math.min(
          streak,
          7
        ) *
          75;

      db.prepare(`
        UPDATE users
        SET
          balance=balance+?,
          last_daily=?,
          streak=?,
          updated_at=?
        WHERE id=?
      `).run(
        reward,
        timestamp,
        streak,
        timestamp,
        tgUser.id
      );

      addTransaction(
        tgUser.id,
        reward,
        "Ежедневный бонус"
      );

      addXp(
        tgUser.id,
        20
      );

      res.json({
        state: getState(
          getUser(tgUser)
        )
      });

    } catch (error) {
      res
        .status(400)
        .json({
          error: error.message
        });
    }
  }
);

app.post(
  "/api/ad-reward",
  (req, res) => {
    try {
      const tgUser = auth(req);

      const last =
        db.prepare(`
          SELECT created_at
          FROM transactions
          WHERE user_id=?
          AND label='Reward-реклама'
          ORDER BY id DESC
          LIMIT 1
        `).get(tgUser.id);

      if (
        last &&
        now() -
          last.created_at <
          60
      ) {
        throw new Error(
          "Рекламный бонус можно получать не чаще раза в минуту."
        );
      }

      db.prepare(`
        UPDATE users
        SET
          balance=balance+50,
          ad_views=ad_views+1,
          updated_at=?
        WHERE id=?
      `).run(
        now(),
        tgUser.id
      );

      addTransaction(
        tgUser.id,
        50,
        "Reward-реклама"
      );

      addXp(
        tgUser.id,
        5
      );

      res.json({
        state: getState(
          getUser(tgUser)
        )
      });

    } catch (error) {
      res
        .status(400)
        .json({
          error: error.message
        });
    }
  }
);

app.post(
  "/api/contract/claim",
  (req, res) => {
    try {
      const tgUser = auth(req);

      const user =
        getUser(tgUser);

      const contractId =
        String(
          req.body?.contractId ||
            ""
        );

      const contract =
        getContracts(user)
          .find(
            (item) =>
              item.id ===
              contractId
          );

      if (
        !contract ||
        !contract.claimable
      ) {
        throw new Error(
          "Контракт ещё не выполнен."
        );
      }

      db.prepare(`
        INSERT OR REPLACE INTO contracts(
          user_id,
          contract_id,
          progress,
          claimed
        )
        VALUES(?,?,?,1)
      `).run(
        tgUser.id,
        contract.id,
        contract.progress
      );

      db.prepare(`
        UPDATE users
        SET
          balance=balance+?,
          completed_contracts=
            completed_contracts+1,
          updated_at=?
        WHERE id=?
      `).run(
        contract.reward,
        now(),
        tgUser.id
      );

      addTransaction(
        tgUser.id,
        contract.reward,
        "Контракт: " +
          contract.title
      );

      addXp(
        tgUser.id,
        25
      );

      res.json({
        state: getState(
          getUser(tgUser)
        )
      });

    } catch (error) {
      res
        .status(400)
        .json({
          error: error.message
        });
    }
  }
);

app.post(
  "/api/withdraw",
  (req, res) => {
    try {
      const tgUser = auth(req);

      const user =
        getUser(tgUser);

      const amount =
        Number(
          req.body?.amount ||
            0
        );

      const wallet =
        String(
          req.body?.wallet ||
            ""
        ).trim();

      if (
        amount < 150000 ||
        amount > user.balance
      ) {
        throw new Error(
          "Недостаточный баланс или сумма меньше 150 000 TONF."
        );
      }

      const validWallet =
        /^(UQ|EQ)[A-Za-z0-9_-]{20,80}$/.test(
          wallet
        ) ||
        /^[A-Za-z0-9_-]+\.ton$/.test(
          wallet
        );

      if (!validWallet) {
        throw new Error(
          "Проверь TON-адрес."
        );
      }

      const result =
        db.prepare(`
          INSERT INTO withdrawals(
            user_id,
            amount,
            wallet,
            status,
            created_at
          )
          VALUES(?,?,?,?,?)
        `).run(
          tgUser.id,
          amount,
          wallet,
          "pending",
          now()
        );

      db.prepare(`
        UPDATE users
        SET
          balance=balance-?,
          updated_at=?
        WHERE id=?
      `).run(
        amount,
        now(),
        tgUser.id
      );

      addTransaction(
        tgUser.id,
        -amount,
        "Заявка на вывод"
      );

      res.json({
        withdrawalId:
          result.lastInsertRowid,
        state: getState(
          getUser(tgUser)
        )
      });

    } catch (error) {
      res
        .status(400)
        .json({
          error: error.message
        });
    }
  }
);

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `TON Falcon listening on ${PORT}; AdsGram ${ADS_BLOCK_ID}`
    );
  }
);

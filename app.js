const tg = window.Telegram?.WebApp;
console.log("Telegram WebApp:", !!tg);
console.log(
  "Telegram initData length:",
  tg?.initData?.length || 0
);
if (tg) {
  tg.ready();
  tg.expand();
}

const API = "/api";

let state = null;
let ad = null;
let busy = false;

const $ = (id) => document.getElementById(id);

function showMessage(message) {
  console.log(message);

  if (tg?.showAlert) {
    tg.showAlert(String(message));
  } else {
    alert(String(message));
  }
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  headers["X-Telegram-Init-Data"] = tg?.initData || "";

  const response = await fetch(API + path, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));
if (!response.ok) {
  throw new Error(
    `Ошибка ${options.method || "GET"} ${API + path}: HTTP ${response.status}`
  );
}if (!response.ok) {
  throw new Error(
    `Ошибка ${options.method || "GET"} ${API + path}: HTTP ${response.status}`
  );
}

  return data;
}

function render() {
  if (!state) return;

  const balance = $("balance");
  const energy = $("energy");
  const energyText = $("energyText");
  const energyBar = $("energyBar");
  const power = $("power");
  const level = $("level");

  if (balance) {
    balance.textContent =
      Number(state.balance || 0).toLocaleString("ru-RU");
  }

  const currentEnergy = Number(state.energy || 0);
  const maxEnergy = Number(state.maxEnergy || 100);

  if (energy) {
    energy.textContent = `${currentEnergy}/${maxEnergy}`;
  }

  if (energyText) {
    energyText.textContent = `${currentEnergy}/${maxEnergy}`;
  }

  if (energyBar) {
    const percent =
      maxEnergy > 0
        ? Math.max(
            0,
            Math.min(100, (currentEnergy / maxEnergy) * 100)
          )
        : 0;

    energyBar.style.width = `${percent}%`;
  }

  if (power) {
    power.textContent = Number(state.power || 1);
  }

  if (level) {
    level.textContent = `LVL ${Number(state.upgradeLevel || 0)}`;
  }
}

async function load() {
  if (!tg?.initData) {
    showMessage(
      "Откройте TON Falcon через мини-приложение Telegram."
    );
    return;
  }

  try {
    const data = await api("/state");

    if (!data.state) {
      throw new Error("Сервер не вернул состояние игрока.");
    }

    state = data.state;

    render();
  } catch (error) {
    showMessage(error.message);
  }
}

/* =========================
   ⛏️ МАЙНИНГ
========================= */

async function mine() {
  if (busy) return;

  busy = true;

  try {
    const data = await api("/mine", {
      method: "POST",
      body: "{}"
    });

    state = data.state;

    render();
  } catch (error) {
    showMessage(error.message);
  } finally {
    busy = false;
  }
}

/* =========================
   ⬆️ УЛУЧШЕНИЕ
========================= */

async function upgrade() {
  if (busy) return;

  busy = true;

  try {
    const data = await api("/upgrade", {
      method: "POST",
      body: "{}"
    });

    state = data.state;

    render();

    if (data.message) {
      showMessage(data.message);
    } else {
      showMessage("Улучшение успешно куплено!");
    }
  } catch (error) {
    showMessage(error.message);
  } finally {
    busy = false;
  }
}

/* =========================
   ⚡ ЭНЕРГИЯ
========================= */

async function boost() {
  if (busy) return;

  busy = true;

  try {
    const data = await api("/boost", {
      method: "POST",
      body: "{}"
    });

    state = data.state;

    render();

    if (data.message) {
      showMessage(data.message);
    } else {
      showMessage("Энергия восстановлена!");
    }
  } catch (error) {
    showMessage(error.message);
  } finally {
    busy = false;
  }
}

/* =========================
   🎁 ЕЖЕДНЕВНЫЙ БОНУС
========================= */

async function daily() {
  if (busy) return;

  busy = true;

  try {
    const data = await api("/daily", {
      method: "POST",
      body: "{}"
    });

    state = data.state;

    render();

    if (data.message) {
      showMessage(data.message);
    } else {
      showMessage("Ежедневный бонус получен!");
    }
  } catch (error) {
    showMessage(error.message);
  } finally {
    busy = false;
  }
}

/* =========================
   📺 ADSGRAM
========================= */

async function rewardedAd() {
  if (busy) return;

  try {
    if (!state) {
      throw new Error("Данные игрока ещё загружаются.");
    }

    const blockId = String(
      state.adsBlockId || "47862"
    );

    if (!window.Adsgram) {
      throw new Error(
        "AdsGram ещё не загрузился. Попробуйте ещё раз."
      );
    }

    if (!ad) {
      ad = window.Adsgram.init({
        blockId: blockId
      });
    }

    busy = true;

    await ad.show();

    const data = await api("/ad-reward", {
      method: "POST",
      body: "{}"
    });

    state = data.state;

    render();

    if (data.message) {
      showMessage(data.message);
    } else {
      showMessage("Награда за рекламу получена!");
    }

  } catch (error) {
    console.error("AdsGram:", error);

    showMessage(
      error.message || "Реклама не была завершена."
    );
  } finally {
    busy = false;
  }
}

/* =========================
   💰 ВЫВОД
========================= */

async function withdraw() {
  const amountInput = $("withdrawAmount");
  const walletInput = $("withdrawWallet");

  const amount = Number(
    amountInput?.value || 0
  );

  const wallet = String(
    walletInput?.value || ""
  ).trim();

  if (!amount || amount <= 0) {
    showMessage("Введите сумму для вывода.");
    return;
  }

  if (!wallet) {
    showMessage("Введите TON-кошелёк.");
    return;
  }

  try {
    const data = await api("/withdraw", {
      method: "POST",
      body: JSON.stringify({
        amount,
        wallet
      })
    });

    state = data.state;

    render();

    showMessage(
      data.message ||
      `Заявка #${data.withdrawalId} создана.`
    );

  } catch (error) {
    showMessage(error.message);
  }
}

/* =========================
   🌐 ГЛОБАЛЬНЫЕ КНОПКИ
========================= */

window.mine = mine;
window.upgrade = upgrade;
window.boost = boost;
window.daily = daily;
window.rewardedAd = rewardedAd;
window.withdraw = withdraw;

/* =========================
   🚀 ЗАПУСК
========================= */

load();

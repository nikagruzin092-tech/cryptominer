const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const API = "/api";
let state = null;
let ad = null;

const $ = (id) => document.getElementById(id);

function showError(message) {
  console.error(message);
  if (tg?.showAlert) tg.showAlert(String(message));
  else alert(String(message));
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  headers["X-Telegram-Init-Data"] = tg?.initData || "";
  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function render() {
  if (!state) return;
  if ($("balance")) $("balance").textContent = Number(state.balance).toLocaleString();
  if ($("energy")) $("energy").textContent = `${state.energy}/${state.maxEnergy}`;
  if ($("power")) $("power").textContent = state.power;
  if ($("level")) $("level").textContent = state.upgradeLevel;
}

async function load() {
  if (!tg?.initData) {
    showError("Откройте TON Falcon через Telegram Mini App.");
    return;
  }
  try {
    state = await api("/state");
    render();
  } catch (e) {
    showError(e.message);
  }
}

async function mine() {
  try {
    state = await api("/mine", { method: "POST", body: "{}" });
    render();
  } catch (e) { showError(e.message); }
}

async function upgrade() {
  try {
    state = await api("/upgrade", { method: "POST", body: "{}" });
    render();
  } catch (e) { showError(e.message); }
}

async function boost() {
  try {
    state = await api("/boost", { method: "POST", body: "{}" });
    render();
  } catch (e) { showError(e.message); }
}

async function daily() {
  try {
    state = await api("/daily", { method: "POST", body: "{}" });
    render();
  } catch (e) { showError(e.message); }
}

async function rewardedAd() {
  try {
    const blockId = String(state?.adsBlockId || "");
    if (!blockId) throw new Error("AdsGram Block ID не настроен.");

    if (!window.Adsgram) throw new Error("AdsGram SDK ещё не загрузился.");

    if (!ad) ad = window.Adsgram.init({ blockId });
    await ad.show();

    // Only after the Rewarded promise resolves do we request the reward.
    state = await api("/ad-reward", { method: "POST", body: "{}" });
    render();
  } catch (e) {
    showError(e.message || "Реклама не завершена.");
  }
}

async function withdraw() {
  const amount = Number($("withdrawAmount")?.value || 0);
  const wallet = String($("withdrawWallet")?.value || "").trim();
  try {
    const data = await api("/withdraw", {
      method: "POST",
      body: JSON.stringify({ amount, wallet })
    });
    state = data.state;
    render();
    showError(`Заявка #${data.withdrawalId} создана.`);
  } catch (e) { showError(e.message); }
}

window.mine = mine;
window.upgrade = upgrade;
window.boost = boost;
window.daily = daily;
window.rewardedAd = rewardedAd;
window.withdraw = withdraw;

load();

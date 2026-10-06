(()=>{"use strict";
const tg=window.Telegram?.WebApp,API="https://cryptominer-production-9a91.up.railway.app/api",ADS_BLOCK_ID="52244";let state=null,ad=null;
if(tg){tg.ready();tg.expand()}const $=id=>document.getElementById(id),fmt=n=>Number(n||0).toLocaleString("ru-RU");
function alertUser(x){tg?.showAlert?tg.showAlert(String(x)):alert(String(x))}
async function api(path,opt={}){const headers={"Content-Type":"application/json",...(opt.headers||{})};headers["X-Telegram-Init-Data"]=tg?.initData||"";const r=await fetch(API+path,{...opt,headers}),d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);return d}
function render(){if(!state)return;$("balance").textContent=fmt(state.balance);$("walletBalance").textContent=fmt(state.balance)+" TONF";$("power").textContent=fmt(state.power);$("energy").textContent=`${fmt(state.energy)}/${fmt(state.maxEnergy)}`;$("passive").textContent=fmt(state.passivePerMinute);$("level").textContent=state.level;$("xp").textContent=`${fmt(state.xp)}/${fmt(state.nextXp)}`;$("clickReward").textContent=fmt(state.power);$("energyFill").style.width=Math.max(0,Math.min(100,state.energy/state.maxEnergy*100))+"%";$("streak").textContent=state.streak+" "+(state.streak===1?"день":"дней");$("totalMined").textContent=fmt(state.stats.totalMined);$("adCount").textContent=fmt(state.stats.adViews);$("refCount").textContent=fmt(state.referrals);$("friendsCount").textContent=fmt(state.referrals);$("doneContracts").textContent=fmt(state.stats.completedContracts);$("contractCount").textContent=state.contracts.filter(x=>!x.completed).length;$("refLink").textContent=state.referralLink;$("powerCost").textContent=fmt(state.upgrades.power.cost);$("energyCost").textContent=fmt(state.upgrades.energy.cost);$("regenCost").textContent=fmt(state.upgrades.regen.cost);$("dailyButton").disabled=!state.dailyAvailable;$("dailyButton").textContent=state.dailyAvailable?"ПОЛУЧИТЬ":"УЖЕ ПОЛУЧЕНО";renderContracts();renderHistory()}
function renderContracts(){const box=$("contracts");box.innerHTML="";state.contracts.forEach(c=>{const p=Math.min(100,Math.floor(c.progress/c.target*100)),e=document.createElement("article");e.className="contract";e.innerHTML=`<b>${c.title}</b><span class="reward">+${fmt(c.reward)} TONF</span><p>${c.description}</p><div class="progress"><i style="width:${p}%"></i></div><p>${fmt(c.progress)} / ${fmt(c.target)}</p>${c.completed?"<button disabled>ВЫПОЛНЕНО ✓</button>":c.claimable?`<button data-claim="${c.id}">ЗАБРАТЬ</button>`:"<button disabled>В ПРОЦЕССЕ</button>"}`;box.appendChild(e)});box.querySelectorAll("[data-claim]").forEach(b=>b.onclick=async()=>{try{const r=await api("/contract/claim",{method:"POST",body:JSON.stringify({contractId:b.dataset.claim})});state=r.state;render()}catch(e){alertUser(e.message)}})}
function renderHistory(){const box=$("history");box.innerHTML=state.history.length?state.history.map(h=>`<div class="history-row"><span>${h.label}</span><b class="${h.amount>=0?"plus":"minus"}">${h.amount>=0?"+":""}${fmt(h.amount)}</b></div>`).join(""):"<p>Операций пока нет.</p>"}
function screen(n){["home","upgrade","contracts","bonus","history","friends","wallet"].forEach(x=>{let e=$("screen-"+x);if(e)e.classList.toggle("active",x===n)});document.querySelectorAll(".nav button").forEach(b=>b.classList.toggle("active",b.dataset.screen===n));scrollTo(0,0)}
document.querySelectorAll("[data-screen]").forEach(b=>b.onclick=()=>screen(b.dataset.screen));
async function load(){if(!tg?.initData){alertUser("Откройте TON Falcon через Telegram Mini App.");return}try{state=(await api("/state")).state;render()}catch(e){alertUser(e.message)}}
$let miningBusy=false;

$("mineButton").onclick=async()=>{
  if(miningBusy)return;
  miningBusy=true;

  try{
    const r=await api("/mine",{
      method:"POST",
      body:"{}"
    });

    state=r.state;
    render();
    tg?.HapticFeedback?.impactOccurred("light");

  }catch(e){
    if(!String(e.message).includes("Слишком быстро")){
      alertUser(e.message);
    }
  }finally{
    setTimeout(()=>{
      miningBusy=false;
    },120);
  }
};
async function up(type){try{state=(await api("/upgrade",{method:"POST",body:JSON.stringify({type})})).state;render()}catch(e){alertUser(e.message)}}$("upgradePower").onclick=()=>up("power");$("upgradeEnergy").onclick=()=>up("energy");$("upgradeRegen").onclick=()=>up("regen");
$("dailyButton").onclick=async()=>{try{state=(await api("/daily",{method:"POST",body:"{}"})).state;render();alertUser("Ежедневный бонус получен.")}catch(e){alertUser(e.message)}};
$("adButton").onclick=async()=>{try{if(!window.Adsgram)throw Error("AdsGram SDK ещё не загрузился.");ad??=window.Adsgram.init({blockId:ADS_BLOCK_ID});await ad.show();state=(await api("/ad-reward",{method:"POST",body:"{}"})).state;render();alertUser("Бонус +50 TONF.")}catch(e){alertUser(e.message||"Реклама не завершена.")}};
$("withdrawButton").onclick=async()=>{try{const amount=Number($("withdrawAmount").value||0),wallet=$("walletAddress").value.trim();const r=await api("/withdraw",{method:"POST",body:JSON.stringify({amount,wallet})});state=r.state;render();alertUser("Заявка #"+r.withdrawalId+" создана.")}catch(e){alertUser(e.message)}};
$("copyRef").onclick=async()=>{try{await navigator.clipboard.writeText(state.referralLink);alertUser("Ссылка скопирована.")}catch(e){alertUser("Не удалось скопировать.")}};
setInterval(async()=>{if(state)try{state=(await api("/state")).state;render()}catch(e){}},15000);load();
})();

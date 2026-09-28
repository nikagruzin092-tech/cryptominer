const tg=window.Telegram?.WebApp;
if(tg){tg.ready();tg.expand();}
const API="/api";
let state=null;

async function api(path, options={}){
  const headers={"Content-Type":"application/json",...(options.headers||{})};
  const initData=tg?.initData||"";
  headers["X-Telegram-Init-Data"]=initData;
  const r=await fetch(API+path,{...options,headers});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||"Ошибка сервера");
  return data;
}
function render(){
 if(!state)return;
 balance.textContent=Number(state.balance).toLocaleString();
 energy.textContent=`${state.energy}/${state.maxEnergy}`;
 energyBar.style.width=`${state.energy/state.maxEnergy*100}%`;
 profit.textContent="+"+state.passive;
 level.textContent=state.level;
 cost.textContent=state.upgradeCost.toLocaleString();
 refs.textContent=state.referrals;
 daily.textContent=state.dailyAvailable?"Доступно":"Завтра";
}
async function load(){try{state=await api("/state");render()}catch(e){alert(e.message)}}
async function mine(e){
 try{state=await api("/mine",{method:"POST"});render();tg?.HapticFeedback?.impactOccurred("light")}
 catch(e){if(e.message!=="Недостаточно энергии")alert(e.message)}
}
async function upgrade(){try{state=await api("/upgrade",{method:"POST"});render();closeModal("mine")}catch(e){alert(e.message)}}
async function boost(){try{state=await api("/boost",{method:"POST"});render()}catch(e){alert(e.message)}}
async function claimDaily(){try{state=await api("/daily",{method:"POST"});render();alert("Ежедневный бонус начислен.")}catch(e){alert(e.message)}}
async function watchAd(){
 if(!window.Adsgram){alert("Реклама пока недоступна.");return}
 try{
   const ad=window.Adsgram.init({blockId:"47176"});
   await ad.show();
   state=await api("/ad-reward",{method:"POST"});
   render();
   alert("Реклама просмотрена. +50 🦅");
 }catch(e){alert("Реклама не была завершена.")}
}
async function withdraw(){
 const address=document.getElementById("tonAddress").value.trim();
 const amount=Number(document.getElementById("amount").value);
 try{
   const data=await api("/withdraw",{method:"POST",body:JSON.stringify({address,amount})});
   state=data.state;render();withdrawStatus.textContent="Заявка создана: "+data.requestId;
 }catch(e){withdrawStatus.textContent=e.message}
}
async function copyReferral(){
 try{const d=await api("/referral");await navigator.clipboard.writeText(d.link);alert("Ссылка скопирована")}catch(e){alert(e.message)}
}
function openModal(id){document.getElementById(id).style.display="flex"}
function closeModal(id){document.getElementById(id).style.display="none"}
setInterval(async()=>{try{state=await api("/state");render()}catch{}},15000);
load();

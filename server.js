const express=require("express");
const crypto=require("crypto");
const fs=require("fs");
const path=require("path");
const Database=require("better-sqlite3");

const app=express();
const PORT=process.env.PORT||3000;
const BOT_TOKEN=process.env.BOT_TOKEN||"";
const BOT_USERNAME=process.env.BOT_USERNAME||"my_crypto_miner_game_bot";
const ADS_BLOCK_ID=process.env.ADS_BLOCK_ID||"47176";
const db=new Database("falcon.db");

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 telegram_id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0,
 energy INTEGER NOT NULL DEFAULT 1500, level INTEGER NOT NULL DEFAULT 1,
 passive INTEGER NOT NULL DEFAULT 0, upgrade_cost INTEGER NOT NULL DEFAULT 100,
 referrals INTEGER NOT NULL DEFAULT 0, last_daily INTEGER NOT NULL DEFAULT 0,
 last_ad INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS withdrawals(
 id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL, address TEXT NOT NULL,
 amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 created_at INTEGER NOT NULL
);
`);

app.use(express.json());
app.use(express.static(__dirname));

function verifyTelegram(initData){
 if(!BOT_TOKEN) throw new Error("BOT_TOKEN не настроен");
 const p=new URLSearchParams(initData||"");
 const hash=p.get("hash"); if(!hash) throw new Error("Нет Telegram initData");
 p.delete("hash");
 const data=[...p.entries()].sort().map(([k,v])=>`${k}=${v}`).join("\n");
 const secret=crypto.createHmac("sha256","WebAppData").update(BOT_TOKEN).digest();
 const calc=crypto.createHmac("sha256",secret).update(data).digest("hex");
 if(!crypto.timingSafeEqual(Buffer.from(calc),Buffer.from(hash))) throw new Error("Неверная Telegram подпись");
 const authDate=Number(p.get("auth_date")||0);
 if(Date.now()/1000-authDate>86400) throw new Error("Старая Telegram сессия");
 const user=JSON.parse(p.get("user")||"{}");
 if(!user.id) throw new Error("Пользователь не найден");
 return String(user.id);
}
function auth(req,res,next){
 try{req.userId=verifyTelegram(req.get("X-Telegram-Init-Data"));next()}
 catch(e){res.status(401).json({error:e.message})}
}
function getUser(id){
 let u=db.prepare("SELECT * FROM users WHERE telegram_id=?").get(id);
 if(!u){db.prepare("INSERT INTO users(telegram_id) VALUES(?)").run(id);u=db.prepare("SELECT * FROM users WHERE telegram_id=?").get(id)}
 return u;
}
function publicState(u){
 const now=Date.now(), daily=now-u.last_daily>=86400000;
 return {balance:u.balance,energy:u.energy,maxEnergy:1500,level:u.level,passive:u.passive,
 upgradeCost:u.upgrade_cost,referrals:u.referrals,dailyAvailable:daily};
}

app.get("/api/state",auth,(req,res)=>res.json(publicState(getUser(req.userId))));

app.post("/api/mine",auth,(req,res)=>{
 const u=getUser(req.userId); if(u.energy< u.level) return res.status(400).json({error:"Недостаточно энергии"});
 db.prepare("UPDATE users SET balance=balance+?,energy=energy-? WHERE telegram_id=?").run(u.level,u.level,req.userId);
 res.json(publicState(getUser(req.userId)));
});

app.post("/api/upgrade",auth,(req,res)=>{
 const u=getUser(req.userId); if(u.balance<u.upgrade_cost)return res.status(400).json({error:"Недостаточно монет"});
 db.prepare("UPDATE users SET balance=balance-upgrade_cost,level=level+1,passive=passive+15,upgrade_cost=CAST(upgrade_cost*1.7 AS INTEGER) WHERE telegram_id=?").run(req.userId);
 res.json(publicState(getUser(req.userId)));
});

app.post("/api/boost",auth,(req,res)=>{
 db.prepare("UPDATE users SET energy=1500 WHERE telegram_id=?").run(req.userId);
 res.json(publicState(getUser(req.userId)));
});

app.post("/api/daily",auth,(req,res)=>{
 const u=getUser(req.userId); if(Date.now()-u.last_daily<86400000)return res.status(400).json({error:"Бонус уже получен"});
 db.prepare("UPDATE users SET balance=balance+1000,last_daily=? WHERE telegram_id=?").run(Date.now(),req.userId);
 res.json(publicState(getUser(req.userId)));
});

app.post("/api/ad-reward",auth,(req,res)=>{
 const u=getUser(req.userId);
 if(Date.now()-u.last_ad<30000)return res.status(429).json({error:"Слишком часто"});
 db.prepare("UPDATE users SET balance=balance+50,last_ad=? WHERE telegram_id=?").run(Date.now(),req.userId);
 res.json(publicState(getUser(req.userId)));
});

app.post("/api/withdraw",auth,(req,res)=>{
 const address=String(req.body.address||"").trim(), amount=Number(req.body.amount);
 if(!/^([EU]Q[A-Za-z0-9_-]{46}|[A-Za-z0-9_-]+\\.ton)$/.test(address))return res.status(400).json({error:"Некорректный TON-адрес"});
 if(!Number.isInteger(amount)||amount<150000)return res.status(400).json({error:"Минимум 150 000"});
 const u=getUser(req.userId); if(u.balance<amount)return res.status(400).json({error:"Недостаточно средств"});
 const id=crypto.randomUUID();
 const tx=db.transaction(()=>{db.prepare("UPDATE users SET balance=balance-? WHERE telegram_id=?").run(amount,req.userId);db.prepare("INSERT INTO withdrawals VALUES(?,?,?,?,?,?)").run(id,req.userId,address,amount,"pending",Date.now())});
 tx();
 res.json({requestId:id,state:publicState(getUser(req.userId))});
});

app.get("/api/referral",auth,(req,res)=>{
 res.json({link:`https://t.me/${BOT_USERNAME}?start=ref_${req.userId}`});
});

app.listen(PORT,()=>console.log(`TON Falcon server: http://localhost:${PORT}`));

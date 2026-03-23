// plugins/economy.js
// Enhanced Economy & Underworld Plugin for NEXUS-MD — Weirdos World
// FULLY INTEGRATED WITH RPG ECOSYSTEM (`rpgplayers` collection)
// v4.0 — Location-locked Rob, Gear-based Stats, Gang Rob, Economy Drains Toggle

const { cmd } = require("../command");
const { MongoClient } = require("mongodb");
const { lidToPhone } = require("../lib/lid");

const uri = process.env.MONGO_URI || "mongodb+srv://botUser:susanoo900@cluster0.6m9ra.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri, {});

let _db;
async function connectDB() {
  if (!_db) {
    await client.connect();
    _db = client.db("test");
  }
  return _db;
}

function now(){ return Date.now(); }
function msToTime(ms){
  if (ms <= 0) return "0s";
  const s = Math.floor((ms/1000)%60), m = Math.floor((ms/60000)%60), h = Math.floor(ms/3600000);
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

// ----------------- Global ID Resolution -----------------
function normalizeId(jidOrDigits) {
    if (!jidOrDigits) return null;
    let s = String(jidOrDigits).split(':')[0].split('@')[0];
    return s.replace(/\D/g, '');
}

async function getPlayerId(conn, jid) {
    if (!jid) return null;
    let str = String(jid);
    if (str.includes('@lid')) {
        try {
            let pn = await lidToPhone(conn, str);
            if (pn) return normalizeId(pn);
        } catch(e) {}
    }
    return normalizeId(str);
}

async function getTargetId(conn, mek, args, argIndex = 0) {
    let targetId = null;
    if (mek.message?.extendedTextMessage?.contextInfo?.participant) {
        targetId = mek.message.extendedTextMessage.contextInfo.participant;
    } else if (mek.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
        targetId = mek.message.extendedTextMessage.contextInfo.mentionedJid[0];
    } else if (args && args[argIndex]) {
        targetId = args[argIndex].replace(/[^0-9@lid]/g, '');
    }
    return await getPlayerId(conn, targetId);
}

function toJid(id) { return id.includes('@') ? id : `${id}@s.whatsapp.net`; }

// ----------------- Unified DB Helpers -----------------
async function getAccount(id) {
  const db = await connectDB();
  const coll = db.collection("weirdo_rpg");
  let acc = await coll.findOne({ _id: id });

  if (!acc) {
    acc = {
        _id: id,
        money: 100,
        bank: 0,
        health: 100, maxHealth: 100,
        energy: 100, maxEnergy: 100,
        strength: 3, defense: 3, speed: 3, dexterity: 3,
        level: 1, exp: 0,
        inventory: {}, properties: {}, titles: [],
        investments: [],
        jailedUntil: 0,
        crimeLevel: 0,
        lastCrimeLevelDecay: Date.now(),
        kidnappedBy: null,
        activeDrugs: [],
        createdAt: new Date()
    };
    await coll.insertOne(acc);
  }

  // Ensure missing economy fields on old accounts
  if (typeof acc.bank !== 'number') acc.bank = 0;
  if (!acc.investments) acc.investments = [];
  if (!acc.inventory) acc.inventory = {};
  if (!acc.properties) acc.properties = {};
  if (typeof acc.crimeLevel !== 'number') acc.crimeLevel = 0;
  if (!acc.lastCrimeLevelDecay) acc.lastCrimeLevelDecay = Date.now();
  if (acc.kidnappedBy === undefined) acc.kidnappedBy = null;
  if (!acc.tycoon) acc.tycoon = {};
  if (!acc.swordStreak) acc.swordStreak = 0;

  // Pet hunger — if not fed in 36h, pet runs away
  if (acc.pet?.type) {
      const hoursSinceFed = (Date.now() - (acc.pet.lastFed || 0)) / 3600000;
      if (hoursSinceFed > 36) {
          const gone = acc.pet.type;
          acc.pet = null;
          // Note: conn not available here, just wipe silently. User sees it on next pet status.
      }
  }

  // Rental eviction
  if (acc.rentedHome && acc.rentedHomeExpiresAt > 0 && acc.rentedHomeExpiresAt <= Date.now()) {
      acc.rentedHome = null;
      acc.rentedHomeExpiresAt = 0;
  }

  // Gear insurance expiry
  if (acc.gearInsurance && acc.gearInsuranceExpiresAt > 0 && acc.gearInsuranceExpiresAt <= Date.now()) {
      acc.gearInsurance = false;
      acc.gearInsuranceExpiresAt = 0;
  }

  // Medical bill on auto-discharge
  if (acc.jailedUntil && acc.jailedUntil > 0 && acc.jailedUntil <= Date.now()) {
      acc.jailedUntil = 0;
      if (acc.health <= 0) acc.health = 20;
      const bill = Math.min(acc.money || 0, iC(500) * (acc.level || 1));
      if (bill > 0) { acc.money = Math.max(0, acc.money - bill); logFinancial(acc, `Hospital discharge fee`, -bill); }
  }

  // Passive crimeLevel decay: -5 per hour
  const hoursSinceDecay = (Date.now() - (acc.lastCrimeLevelDecay || 0)) / 3600000;
  if (hoursSinceDecay >= 1) {
      const ticks = Math.floor(hoursSinceDecay);
      acc.crimeLevel = Math.max(0, (acc.crimeLevel || 0) - (5 * ticks));
      acc.lastCrimeLevelDecay = Date.now();
  }

  // Hourly economy drains
  await applyHourlyDrains(acc);

  // Loan shark compound interest — ticks every 5 min regardless of what command runs
  if (acc.activeLoan && acc.activeLoan.owed > 0) {
      const COMPOUND_INTERVAL = 5 * 60 * 1000;
      const RATE_PER_5MIN     = 0.02; // 2% per 5 min
      const intervals = Math.floor((Date.now() - (acc.activeLoan.lastCompound || acc.activeLoan.takenAt || 0)) / COMPOUND_INTERVAL);
      if (intervals > 0) {
          let owed = acc.activeLoan.owed;
          for (let i = 0; i < intervals; i++) owed = Math.ceil(owed * (1 + RATE_PER_5MIN));
          acc.activeLoan.owed         = owed;
          acc.activeLoan.lastCompound = (acc.activeLoan.lastCompound || acc.activeLoan.takenAt) + intervals * COMPOUND_INTERVAL;
      }
      // Auto-deduct after 2 hours unpaid — shark takes 25% of wallet+bank each time
      const AGE_MS = Date.now() - (acc.activeLoan.takenAt || 0);
      if (AGE_MS >= 2 * 60 * 60 * 1000 && (acc.money > 0 || acc.bank > 0)) {
          const targetPay = Math.ceil(acc.activeLoan.owed * 0.25);
          const fromWallet = Math.min(acc.money || 0, targetPay);
          acc.money -= fromWallet;
          const fromBank = Math.min(acc.bank || 0, targetPay - fromWallet);
          acc.bank = Math.max(0, (acc.bank || 0) - fromBank);
          const forcePay = fromWallet + fromBank;
          if (forcePay > 0) {
              acc.activeLoan.owed -= forcePay;
              logFinancial(acc, `🦈 Shark collected — wallet + bank`, -forcePay);
          }
          if (acc.activeLoan.owed <= 0) acc.activeLoan = null;
      }
  }

  // Rob immunity expiry
  if (acc.robImmunityUntil && acc.robImmunityUntil <= Date.now()) {
      acc.robImmunityUntil = 0;
  }

  // Extortion auto-collection — if this player has an active extortion demand, pay it now
  if (global.extortions && global.extortions[acc._id]) {
      const ext = global.extortions[acc._id];
      if (ext.expiresAt > Date.now()) {
          const pay = Math.min(acc.money || 0, ext.amount);
          if (pay > 0) {
              acc.money -= pay;
              logFinancial(acc, `Extortion payment to @${ext.extorterId}`, -pay);
              // Pay the extorter
              try {
                  const db = await connectDB();
                  await db.collection('rpgplayers').updateOne({ _id: ext.extorterId }, { $inc: { money: pay } });
              } catch(_) {}
          }
          delete global.extortions[acc._id];
      } else {
          delete global.extortions[acc._id];
      }
  }

  return acc;
}

async function saveAccount(acc) {
  const db = await connectDB();
  await db.collection("weirdo_rpg").updateOne({ _id: acc._id }, { $set: acc }, { upsert: true });
}

function isHospitalized(acc) {
    return (acc.jailedUntil && acc.jailedUntil > now()) || acc.health <= 0;
}

function isKidnapped(acc) {
    return acc.kidnappedBy && acc.kidnappedBy !== null;
}

function isInFlight(acc) {
    return acc.travelingUntil && acc.travelingUntil > now();
}

function logFinancial(acc, description, amount) {
    const d = new Date();
    const timeStr = `${d.toLocaleDateString('en-GB', { day:'2-digit', month:'short' })} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    const sign = amount >= 0 ? `+${fmtMoney(amount)}` : `-${fmtMoney(Math.abs(amount))}`;
    acc.financialHistory = acc.financialHistory || [];
    acc.financialHistory.push(`[${timeStr}] ${sign} — ${description}`);
    if (acc.financialHistory.length > 20) acc.financialHistory.shift();
}

function crimeLevelBar(lvl) {
    const l = lvl || 0;
    if (l === 0) return `⚪ 0/100 (Clean)`;
    if (l < 25) return `🟢 ${l}/100 (Cool)`;
    if (l < 50) return `🟡 ${l}/100 (Noticed)`;
    if (l < 75) return `🟠 ${l}/100 (Wanted)`;
    return `🔴 ${l}/100 (HOT — Liable to arrest!)`;
}

async function addExp(acc, amount){
  acc.exp = (acc.exp || 0) + (amount || 0);
  let leveled = false;
  while (acc.exp >= (acc.level * 100)) {
    acc.exp -= (acc.level * 100);
    acc.level += 1;
    acc.maxHealth += 10;
    acc.health = acc.maxHealth;
    acc.maxEnergy += 5;
    acc.energy = acc.maxEnergy;
    acc.money += 250 * acc.level;
    leveled = true;
  }
  await saveAccount(acc);
  return leveled;
}

function fmtMoney(x) { return `$${Number(x).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`; }

const VAT_RATE = 0.12;
function applyVAT(gross) {
    const vat = Math.ceil(gross * VAT_RATE);
    return { net: gross - vat, vat };
}

// ─── GLOBAL FLAGS — safe defaults before DB config loads ────────────────────
if (global.weirdo_drains_enabled === undefined) global.weirdo_drains_enabled = true;
if (global.weirdo_tax_enabled    === undefined) global.weirdo_tax_enabled    = true;
if (global.INFLATION_MULT        === undefined) global.INFLATION_MULT        = 1;

// Scale any cost by current inflation
function iC(base) { return Math.ceil(base * global.INFLATION_MULT); }

// Tax income tracker — only active when tax is enabled
function addTaxableIncome(acc, amount) {
    if (!amount || amount <= 0) return;
    if (!global.weirdo_tax_enabled) return;
    acc.taxableIncome = (acc.taxableIncome || 0) + amount;
}

// Location normaliser — same as torn.js, keeps legacy "Torn City" compatible
const LOC_ALIASES_ECO = { 'torn city':'Weirdos World','torn':'Weirdos World','torncity':'Weirdos World','weirdosworld':'Weirdos World','home':'Weirdos World','ww':'Weirdos World','weirdos world':'Weirdos World','mexico':'Mexico','london':'London','japan':'Japan','switzerland':'Switzerland','swiss':'Switzerland' };
function normLoc(loc) { if (!loc) return 'Weirdos World'; const k = loc.trim().toLowerCase(); return LOC_ALIASES_ECO[k] || loc.trim(); }

// Persist drain/inflation config to DB (same collection as torn.js GameConfig)
async function saveGameConfig() {
    try {
        const db = await connectDB();
        await db.collection('rpggameconfigs').updateOne(
            { _id: 'game_config' },
            { $set: { inflationMult: global.INFLATION_MULT, drainsEnabled: global.weirdo_drains_enabled } },
            { upsert: true }
        );
    } catch (e) { console.error('economy saveGameConfig error:', e.message); }
}

const PROPERTY_TAX_RATE  = 0.002;
const WEALTH_TAX_BRACKETS = [
    { threshold: 1_000_000_000, rate: 0.010 },
    { threshold: 100_000_000,  rate: 0.005 },
    { threshold: 10_000_000,   rate: 0.002 },
    { threshold: 1_000_000,    rate: 0.001 },
];
const GEAR_MAINTENANCE_BASE = { legendary: 50000, epic: 15000, rare: 5000, uncommon: 1000, common: 200 };
const FACTION_DUES_BASE = 5000;

function getWealthTaxRate(balance) {
    for (const b of WEALTH_TAX_BRACKETS) { if (balance >= b.threshold) return b.rate; }
    return 0;
}

const GEAR_RARITIES = { railgun:'legendary', nuclearbriefcase:'legendary', godspear:'legendary', warlordhelm:'legendary',
    powerfists:'legendary', titanlegs:'legendary', hermes:'legendary', glacierstriders:'legendary',
    royalsword:'legendary', queenhelmet:'legendary', oniblade:'legendary', mythiclegrob:'legendary',
    flamethrower:'epic', precisionrifle:'epic', energyblade:'epic', titanhelmet:'epic', combatgauntlets:'epic',
    combatlegs:'epic', speedforce:'epic', dragonscale:'epic', cartelhelmet:'epic', goldenknuckles:'epic',
    desertstriders:'epic', knightgauntlet:'epic', royalguardleg:'epic', kabuto:'epic', ironzori:'epic',
    alpine:'epic', mountainknight:'epic', avalanchegloves:'epic', sniperx:'epic', grenadlauncher:'epic',
    sniper:'rare', doubleshotgun:'rare', naginata:'rare', ak47:'rare', obsidianknife:'rare', crossbow:'rare',
    tacticalhelmet:'rare', legguards:'rare', tacboots:'rare', chainmail:'rare', serpentskin:'rare',
    cowboyboots:'rare', tophat:'rare', knightleg:'rare', suneate:'rare', ninjawaraji:'rare',
    swisshelmet:'rare', bankervault:'rare', alpineboots:'rare', knifegloves:'rare', tekko:'rare',
    smg:'uncommon', taserx2:'uncommon', crownofthorns:'uncommon', superherosuit:'uncommon',
    motorcyclehelmet:'uncommon', tackleknees:'uncommon', heavyboots:'uncommon', rollerskates:'uncommon',
    ninjahandwraps:'uncommon', hachiganji:'uncommon', snowguard:'uncommon', lordgloves:'uncommon',
    lucha:'uncommon', armadilloleg:'uncommon', oxfordsteel:'uncommon' };

function getItemRarity(itemId) { return GEAR_RARITIES[itemId] || 'common'; }

async function applyHourlyDrains(acc) {
    if (!global.weirdo_drains_enabled) return;
    const currentTime = now();
    const hourMs = 3_600_000;

    // Property tax
    const propTicks = Math.floor((currentTime - (acc.lastPropertyTax || currentTime)) / hourMs);
    if (propTicks >= 1 && acc.properties && Object.keys(acc.properties).length > 0) {
        let propTax = 0;
        for (const [propId, qty] of Object.entries(acc.properties)) {
            propTax += Math.ceil((DEFAULT_PROP_PRICES[propId] || 0) * PROPERTY_TAX_RATE * (qty || 0) * propTicks);
        }
        if (propTax > 0) {
            if (acc.money >= propTax) { acc.money -= propTax; }
            else {
                // evict from most expensive property
                const sorted = Object.entries(acc.properties).sort((a,b) => (DEFAULT_PROP_PRICES[b[0]]||0)-(DEFAULT_PROP_PRICES[a[0]]||0));
                if (sorted.length > 0) {
                    const [evId] = sorted[0];
                    acc.properties[evId] = Math.max(0, (acc.properties[evId]||1) - 1);
                    if (acc.properties[evId] === 0) delete acc.properties[evId];
                }
                acc.money = Math.max(0, acc.money - propTax);
            }
        }
        acc.lastPropertyTax = currentTime;
    }

    // Wealth tax
    const wealthTicks = Math.floor((currentTime - (acc.lastWealthTax || currentTime)) / hourMs);
    if (wealthTicks >= 1) {
        const total = (acc.money || 0) + (acc.bank || 0);
        const rate = getWealthTaxRate(total);
        if (rate > 0) {
            const wt = Math.ceil(total * rate * wealthTicks);
            const walletShare = Math.ceil(acc.money * rate * wealthTicks);
            const bankShare   = Math.ceil((acc.bank||0) * rate * wealthTicks);
            acc.money = Math.max(0, acc.money - walletShare);
            acc.bank  = Math.max(0, (acc.bank||0) - bankShare);
        }
        acc.lastWealthTax = currentTime;
    }

    // Gear maintenance
    const gearTicks = Math.floor((currentTime - (acc.lastGearMaintenance || currentTime)) / hourMs);
    if (gearTicks >= 1) {
        const slots = ['equippedWeapon','equippedArmor','equippedHelmet','equippedGloves','equippedKneePads','equippedBoots'];
        for (const slot of slots) {
            if (!acc[slot]) continue;
            const cost = iC(GEAR_MAINTENANCE_BASE[getItemRarity(acc[slot])] || 200) * gearTicks;
            if (acc.money >= cost) { acc.money -= cost; }
            else { acc[slot] = null; } // unequip if can't pay
        }
        acc.lastGearMaintenance = currentTime;
    }

    // Faction dues
    const factionTicks = Math.floor((currentTime - (acc.lastFactionDues || currentTime)) / hourMs);
    if (factionTicks >= 1 && acc.faction) {
        const dues = iC(FACTION_DUES_BASE) * factionTicks;
        if (acc.money >= dues) { acc.money -= dues; }
        else { acc.faction = null; } // kicked for non-payment
        acc.lastFactionDues = currentTime;
    }
}

// Rough property price lookup for tax (economy.js doesn't have full shop list)
const DEFAULT_PROP_PRICES = {
    shack: 5000, condo: 500000, island: 500000000,
    cartelmansion: 3500000, hideout: 75000,
    penthouse: 1500000, townhouse: 300000,
    ryokan: 850000, zenmansion: 6000000,
    cabin: 150000, chalet: 2000000, castle: 20000000
};

// Gear stat bonuses mirror (matches torn.js DEFAULT_SHOP entries)
// format: itemId → { atkBonus, defBonus, strBonus, spdBonus, dexBonus }
const GEAR_STAT_BONUSES = {
    // ── weapons ──
    knife:          { atkBonus: 10 }, dagger:        { atkBonus: 22 },
    bat:            { atkBonus: 18 }, machete:       { atkBonus: 35 },
    katana:         { atkBonus: 60 }, smg:           { atkBonus: 75 },
    shotgun:        { atkBonus: 55 }, doubleshotgun: { atkBonus: 85 },
    ar15:           { atkBonus: 95 }, sniper:        { atkBonus: 120 },
    precisionrifle: { atkBonus: 145 },flamethrower:  { atkBonus: 160 },
    railgun:        { atkBonus: 280, strBonus: 30 }, energyblade: { atkBonus: 170, dexBonus: 20 },
    naginata:       { atkBonus: 105, spdBonus: 12 }, ak47:        { atkBonus: 110 },
    obsidianknife:  { atkBonus: 95, dexBonus: 10 },  crossbow:    { atkBonus: 48 },
    taserx2:        { atkBonus: 45 }, stunguns:      { atkBonus: 88 },
    grenadlauncher: { atkBonus: 195 },godspear:      { atkBonus: 350, strBonus: 40 },
    royalsword:     { atkBonus: 320, strBonus: 35 }, oniblade:    { atkBonus: 310, dexBonus: 30 },
    nuclearbriefcase:{ atkBonus: 400, strBonus: 50 },sniperx:     { atkBonus: 210 },
    // ── armor (body) ──
    leatherjacket:  { defBonus: 8 },  chainmail:     { defBonus: 30 },
    kevlar:         { defBonus: 55 }, tacticalvest:  { defBonus: 80 },
    dragonscale:    { defBonus: 150 },superherosuit: { defBonus: 30, spdBonus: 8 },
    trasharmor:     { defBonus: 6 },
    // ── head ──
    motorcyclehelmet:{ defBonus: 15 },tacticalhelmet:{ defBonus: 40 },
    warlordhelm:    { defBonus: 120, strBonus: 25 }, titanhelmet: { defBonus: 90, strBonus: 15 },
    tinfoilhat:     { defBonus: 4 },  crownofthorns: { defBonus: 25, strBonus: 5 },
    lucha:          { defBonus: 28, strBonus: 10 },  cartelhelmet: { defBonus: 130, strBonus: 15 },
    tophat:         { defBonus: 55, dexBonus: 12 },  queenhelmet: { defBonus: 220, strBonus: 30, dexBonus: 15 },
    hachiganji:     { defBonus: 18, dexBonus: 12 },  kabuto:      { defBonus: 140, strBonus: 20, dexBonus: 10 },
    swisshelmet:    { defBonus: 72, dexBonus: 8 },   alpine:      { defBonus: 160, strBonus: 20 },
    // ── hands ──
    powerfists:     { strBonus: 50, defBonus: 60 },  combatgauntlets: { defBonus: 80, strBonus: 30 },
    ovegloves:      { defBonus: 2 }, knifegloves:   { defBonus: 38, strBonus: 22 },
    serpentskin:    { defBonus: 30, dexBonus: 15 },  goldenknuckles: { defBonus: 70, strBonus: 50 },
    lordgloves:     { defBonus: 20, dexBonus: 8 },   knightgauntlet: { defBonus: 95, strBonus: 45 },
    tekko:          { defBonus: 32, dexBonus: 18 },  ninjahandwraps: { defBonus: 16, dexBonus: 10 },
    bankervault:    { defBonus: 45, strBonus: 20 },  avalanchegloves:{ defBonus: 130, strBonus: 90 },
    // ── legs ──
    tackleknees:    { defBonus: 20, spdBonus: 5 },   legguards:   { defBonus: 50 },
    combatlegs:     { defBonus: 75, spdBonus: 20 },  titanlegs:   { defBonus: 180, strBonus: 40 },
    jeansleg:       { defBonus: 4 }, armadilloleg:  { defBonus: 25, spdBonus: 8 },
    knightleg:      { defBonus: 65, spdBonus: 15 },  royalguardleg: { defBonus: 190, spdBonus: 55 },
    suneate:        { defBonus: 55, spdBonus: 20 },  mythiclegrob: { defBonus: 200, spdBonus: 60 },
    snowguard:      { defBonus: 28, spdBonus: 10 },  mountainknight: { defBonus: 100, spdBonus: 30 },
    // ── feet ──
    heavyboots:     { defBonus: 25, spdBonus: 8 },   tacboots:    { defBonus: 55, spdBonus: 18 },
    speedforce:     { defBonus: 90, spdBonus: 60 },  hermes:      { defBonus: 150, spdBonus: 120 },
    flipflops:      { defBonus: 2, spdBonus: 3 },    rollerskates: { defBonus: 18, spdBonus: 30 },
    cowboyboots:    { defBonus: 42, spdBonus: 22 },  desertstriders: { defBonus: 80, spdBonus: 50 },
    oxfordsteel:    { defBonus: 20, spdBonus: 10 },  ninjawaraji: { defBonus: 38, spdBonus: 35 },
    ironzori:       { defBonus: 88, spdBonus: 55 },  alpineboots: { defBonus: 58, spdBonus: 28 },
    glacierstriders:{ defBonus: 170, spdBonus: 100 },
};

// Sum all gear bonuses for a player (reads equipped slots)
function getEconGearBonus(acc) {
    const slots = ['equippedWeapon','equippedArmor','equippedHelmet','equippedGloves','equippedKneePads','equippedBoots'];
    const total = { atkBonus: 0, defBonus: 0, strBonus: 0, spdBonus: 0, dexBonus: 0 };
    for (const slot of slots) {
        const item = acc[slot];
        if (!item) continue;
        const b = GEAR_STAT_BONUSES[item] || {};
        total.atkBonus += b.atkBonus || 0;
        total.defBonus += b.defBonus || 0;
        total.strBonus += b.strBonus || 0;
        total.spdBonus += b.spdBonus || 0;
        total.dexBonus += b.dexBonus || 0;
    }
    return total;
}

// ----------------- System Data -----------------
const BLACKMARKET = {
  luckycharm: { price: 15000, desc: "Better odds in casino/wagers (Consumed automatically)." },
  lockpick:   { price: 5000,  desc: "Increases your robbery success rate (Consumed)." },
  medkit:     { price: 120,   desc: "Heals you. Discharges you from hospital." }
};

const JOBS = [
  { name: "street cleaner",   min: 200,   max: 500,    expReq: 0 },
  { name: "delivery driver",  min: 500,   max: 1000,   expReq: 10 },
  { name: "mechanic",         min: 800,   max: 1600,   expReq: 25 },
  { name: "security guard",   min: 1200,  max: 2400,   expReq: 40 },
  { name: "teacher",          min: 2000,  max: 3600,   expReq: 80 },
  { name: "nurse",            min: 2800,  max: 4800,   expReq: 120 },
  { name: "police officer",   min: 3600,  max: 6400,   expReq: 180 },
  { name: "lawyer",           min: 6000,  max: 10000,  expReq: 300 },
  { name: "software engineer",min: 10000, max: 18000,  expReq: 500 },
  { name: "surgeon",          min: 16000, max: 28000,  expReq: 800 },
  { name: "astronaut",        min: 32000, max: 60000,  expReq: 1500 }
];

/* ----------------- Commands ------------------ */

// WALLET
async function handleWalletCmd(conn, mek, m, { args, reply }) {
  try {
      const senderId = await getPlayerId(conn, m.sender);
      const CREATOR_ID = '2348084644182';

      // Creator can view any player by replying/mentioning
      let id = senderId;
      if (senderId === CREATOR_ID) {
          const targetId = await getTargetId(conn, mek, args || [], 0).catch(() => null);
          if (targetId && targetId !== senderId) id = targetId;
      }

      const acc = await getAccount(id);

      let status = "🟢 Free";
      if (isInFlight(acc)) {
          status = `✈️ In-flight → ${acc.travelingTo} (${msToTime(acc.travelingUntil - now())} left)`;
      } else if (isKidnapped(acc)) {
          status = `🔒 KIDNAPPED by @${acc.kidnappedBy}`;
      } else if (isHospitalized(acc)) {
          status = acc.health <= 0 ? `🏥 Hospitalized (${msToTime(acc.jailedUntil - now())})` : `🚔 Jailed (${msToTime(acc.jailedUntil - now())})`;
      }

      const viewingOther = id !== senderId;
      const text = `${viewingOther ? `👑 *Viewing: @${acc._id}*\n` : ''}👤 *${acc.username || 'Citizen'}* (@${acc._id})\n` +
                   `💸 Wallet: ${fmtMoney(acc.money)}\n` +
                   `🏦 Bank: ${fmtMoney(acc.bank)}\n` +
                   `⭐ Level: ${acc.level} (${acc.exp} XP)\n` +
                   `🔫 Weapon: ${acc.equippedWeapon || 'None'} (Ammo: ${acc.ammo || 0})\n` +
                   `🔥 Crime Heat: ${crimeLevelBar(acc.crimeLevel)}\n` +
                   `📍 Status: ${status}`;
      return conn.sendMessage(m.chat, { text, mentions: [toJid(acc._id)] }, { quoted: mek });
  } catch(e) { console.error(e); }
}
cmd({ pattern: 'wallet',  desc: 'Check your wallet and bank balance', category: 'rpg', filename: __filename }, handleWalletCmd);
cmd({ pattern: 'bankbal', desc: 'Check finances (alias: wallet)',     category: 'rpg', filename: __filename }, handleWalletCmd);

// BANKING
cmd({ pattern: "bank", desc: "Deposit or withdraw safe money", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const senderId   = await getPlayerId(conn, m.sender);
      const CREATOR_ID = '2348084644182';

      const action = (args[0] || "").toLowerCase();
      if (!action || !["deposit","withdraw","bal"].includes(action))
          return reply(`Usage: bank deposit <amount|all> | bank withdraw <amount|all> | bank bal`);

      // ── CREATOR PATH: bank deposit @player <amount> ───────────────────────
      // Only enters creator path if there's BOTH a mention AND an amount after it
      let id = senderId;
      let amountRaw = args[1] || "";

      if (senderId === CREATOR_ID) {
          // Check if args[1] looks like a mention (not a number)
          const possibleMention = args[1] || "";
          const looksLikeMention = possibleMention.startsWith('@') || possibleMention.match(/^\d{10,}(@|$)/);
          if (looksLikeMention && args[2]) {
              const targetId = await getTargetId(conn, mek, args, 1).catch(() => null);
              if (targetId && targetId !== senderId) {
                  id = targetId;
                  amountRaw = args[2];
              }
          }
      }

      const acc = await getAccount(id);
      const isCreatorAction = id !== senderId;

      if (!isCreatorAction && isHospitalized(acc)) return reply(`🚨 Action restricted. You are incarcerated or hospitalized.`);
      if (!isCreatorAction && isKidnapped(acc)) return reply(`🔒 You are kidnapped.`);

      if (action === "bal") return reply(`🏦 ${isCreatorAction?`@${id}'s `:``}Bank Balance: ${fmtMoney(acc.bank)}`);

      let amount = 0;
      if (amountRaw.toLowerCase() === "all") amount = action === "deposit" ? acc.money : acc.bank;
      else amount = parseInt(amountRaw, 10);
      if (isNaN(amount) || amount <= 0) return reply(`Invalid amount. Usage: bank ${action} <amount|all>`);

      if (action === "deposit") {
        if (acc.money < amount) return reply(`Not enough cash. Wallet: ${fmtMoney(acc.money)}`);
        acc.money -= amount; acc.bank += amount;
        logFinancial(acc, `Bank deposit${isCreatorAction?' (creator)':''}`, -amount);
        await saveAccount(acc);
        return reply(`✅ ${isCreatorAction?`Deposited ${fmtMoney(amount)} for @${id}.`:`Deposited ${fmtMoney(amount)}.`}\nWallet: ${fmtMoney(acc.money)} | Bank: ${fmtMoney(acc.bank)}`);
      } else {
        if (acc.bank < amount) return reply(`Not enough in bank. Bank: ${fmtMoney(acc.bank)}`);
        acc.bank -= amount; acc.money += amount;
        logFinancial(acc, `Bank withdraw${isCreatorAction?' (creator)':''}`, amount);
        await saveAccount(acc);
        return reply(`✅ ${isCreatorAction?`Withdrew ${fmtMoney(amount)} for @${id}.`:`Withdrew ${fmtMoney(amount)}.`}\nWallet: ${fmtMoney(acc.money)} | Bank: ${fmtMoney(acc.bank)}`);
      }
  } catch(e) { console.error('bank error', e); }
});

// PAYDAY
cmd({ pattern: "payday", desc: "Claim economy daily", category: "rpg", filename: __filename }, async (conn, mek, m, { reply }) => {
  try {
      const id = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);
      if (isHospitalized(acc)) return reply(`🚨 Action restricted.`);
      if (isKidnapped(acc)) return reply(`🔒 You are kidnapped. Escape or pay the ransom first.`);

      const DAY = 24*60*60*1000;
      const last = acc.cooldowns?.payday || 0;
      if (now() - last < DAY) return reply(`⏳ The bank is processing your paycheck. Return in ${msToTime(DAY - (now() - last))}`);

      const gross = 5000 + Math.floor(Math.random() * 10000);
      const { net: reward, vat } = applyVAT(gross);
      acc.money += reward;

      acc.cooldowns = acc.cooldowns || {};
      acc.cooldowns.payday = now();

      const leveled = await addExp(acc, 25);
      logFinancial(acc, `Daily Payday`, reward);
      return reply(`💼 *PAYDAY!* Gross: ${fmtMoney(gross)} — 🏛️ VAT (12%): -${fmtMoney(vat)} = *${fmtMoney(reward)}* + 25 XP!${leveled ? `\n🎉 Level Up! You are now level ${acc.level}!` : ''}`);
  } catch(e) { console.error(e); }
});

// SHIFTS
cmd({ pattern: "shifts", desc: "List available tier jobs", category: "rpg", filename: __filename }, async (conn, mek, m, { reply }) => {
  let out = "🏢 *Corporate & Street Shifts:*\n_Require RPG Experience (XP) to unlock._\n\n";
  for (const j of JOBS) out += `• *${j.name.replace(/_/g," ").toUpperCase()}* — Pays ${fmtMoney(j.min)}-${fmtMoney(j.max)} (Req: ${j.expReq} XP)\n`;
  out += "\n*Command:* shift <job name>";
  return reply(out);
});

cmd({ pattern: "shift", desc: "Work a shift", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);
      if (isHospitalized(acc)) return reply(`🚨 You cannot go to work from a hospital bed/jail cell.`);
      if (isKidnapped(acc)) return reply(`🔒 You are kidnapped. You can't work right now.`);
      if (isInFlight(acc)) return reply(`✈️ You're in-flight to ${acc.travelingTo}. Work when you land.`);

      const COOLDOWN = 30*60*1000;
      const last = acc.cooldowns?.shift || 0;
      if (now() - last < COOLDOWN) return reply(`⏳ You are tired. Shift starts in ${msToTime(COOLDOWN - (now() - last))}`);

      let chosen;
      const requested = (args.join(" ") || "").toLowerCase();
      if (requested) {
        chosen = JOBS.find(j => j.name === requested);
        if (!chosen) return reply("Job not found. Use `shifts` to list available jobs.");
        if ((acc.exp || 0) < chosen.expReq) return reply(`❌ You lack experience. You need ${chosen.expReq} XP for this position.`);
      } else {
        const possible = JOBS.filter(j => (acc.exp || 0) >= j.expReq);
        chosen = possible[Math.floor(Math.random() * possible.length)];
      }

      // Live wages — scale with global wage index (shared from torn.js market engine)
      const wageM = global.WAGE_INDEX ?? 1.0;
      const gross = Math.ceil((chosen.min + Math.floor(Math.random()*(chosen.max - chosen.min + 1))) * wageM);
      const wageTag = wageM > 1.15 ? ' 📈' : wageM < 0.85 ? ' 📉' : '';
      const { net: pay, vat } = applyVAT(gross);
      acc.money += pay;
      addTaxableIncome(acc, pay);
      acc.jobsDone = (acc.jobsDone || 0) + 1;

      acc.cooldowns = acc.cooldowns || {};
      acc.cooldowns.shift = now();

      const leveled = await addExp(acc, Math.floor(pay/100) + 5);
      logFinancial(acc, `Shift: ${chosen.name}`, pay);
      return reply(`👔 *${chosen.name.toUpperCase()}* shift complete!${wageTag}\nGross: ${fmtMoney(gross)} | 🏛️ VAT (12%): -${fmtMoney(vat)} | *Net: ${fmtMoney(pay)}*${leveled ? `\n🎉 Level Up! You are now level ${acc.level}!` : ''}`);
  } catch(e) { console.error(e); }
});

// ROB — Strength-based outcome, crime bar tracking
// ROB — same location, full stat-based outcome
cmd({ pattern: "rob", desc: "rob @user (must be in same city)", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const attackerId = await getPlayerId(conn, m.sender);
      const targetId   = await getTargetId(conn, mek, args, 0);
      if (!targetId)              return reply("Tag someone to rob. Usage: rob @user");
      if (targetId === attackerId) return reply("You can't rob yourself.");

      const acc    = await getAccount(attackerId);
      const victim = await getAccount(targetId);

      if (isHospitalized(acc)) return reply(`🚨 You're hospitalized or in jail. Can't rob from there.`);
      if (isKidnapped(acc))    return reply(`🔒 You're kidnapped. Escape first.`);
      if (isInFlight(acc))     return reply(`✈️ You're in-flight. Rob when you land.`);
      if (isInFlight(victim))  return reply(`✈️ That player is in-flight and unreachable.`);
      if (victim.robImmunityUntil && victim.robImmunityUntil > now()) {
          return reply(`🛡️ *${victim.username || targetId}* has active rob protection for another ${msToTime(victim.robImmunityUntil - now())}. Find someone else.`);
      }

      // ── SAME LOCATION REQUIRED ────────────────────────────────────────────
      const myCity     = normLoc(acc.location);
      const victimCity = normLoc(victim.location);
      if (myCity !== victimCity) {
          return reply(`🌍 *Different city!*\nYou're in *${myCity}* — they're in *${victimCity}*.\nTravel there first to rob them.`);
      }

      const COOLDOWN = 20 * 60 * 1000;
      if (now() - (acc.lastRob || 0) < COOLDOWN)
          return reply(`⏳ Lay low for ${msToTime(COOLDOWN - (now() - (acc.lastRob || 0)))} before robbing again.`);

      if (!victim.money || victim.money <= 100)
          return reply("That player is broke. Nothing worth taking.");

      // ── FULL STAT + GEAR + LEVEL FORMULA ─────────────────────────────────
      const accGear  = getEconGearBonus(acc);
      const vicGear  = getEconGearBonus(victim);

      // Level scaling: +8% per level above 1, same formula as attack command
      const atkLvlMult = 1 + ((acc.level    || 1) - 1) * 0.08;
      const defLvlMult = 1 + ((victim.level || 1) - 1) * 0.08;

      // Pet combat power — a dragon fighting alongside you adds 200 raw power
      const atkPetPower = (() => { const p = getPetBonus(acc);    return (p.strBonus||0) + (p.spdBonus||0) + (p.dexBonus||0); })();
      const defPetPower = (() => { const p = getPetBonus(victim); return (p.defBonus||0) + (p.strBonus||0); })();

      let atkPower = ((acc.strength || 3) + (acc.speed || 3) + accGear.atkBonus + accGear.strBonus + accGear.spdBonus + atkPetPower) * atkLvlMult;
      let usedStr  = '';

      // Ranged weapon consumes ammo, melee does not
      if (acc.equippedWeapon && (acc.ammo || 0) > 0) {
          acc.ammo -= 1;
          usedStr = `\n🔫 Drew ${acc.equippedWeapon}! (Ammo -1)`;
      } else if (acc.equippedWeapon) {
          usedStr = `\n🔪 Raised ${acc.equippedWeapon}!`;
      }
      if ((acc.inventory?.lockpick || 0) > 0) {
          atkPower += 15; acc.inventory.lockpick -= 1; usedStr += `\n🔓 Lockpick used.`;
      }
      if ((acc.inventory?.luckycharm || 0) > 0) {
          atkPower += 20; acc.inventory.luckycharm -= 1; usedStr += `\n🍀 Lucky Charm used!`;
      }

      // Defender power: all defensive stats + gear + level + pet
      const defPower = ((victim.strength || 3) + (victim.defense || 3)
                     + vicGear.defBonus + vicGear.strBonus + vicGear.dexBonus + defPetPower
                     + (victim.equippedWeapon && (victim.ammo || 0) > 0 ? 45 : victim.equippedWeapon ? 20 : 0)) * defLvlMult;

      const powerRatio = atkPower / Math.max(1, defPower);

      // Weaker attackers are heavily penalised — a ratio <1 caps at 20% max
      let successChance;
      if (powerRatio < 1.0) {
          successChance = Math.max(0.05, 0.20 * powerRatio);
      } else {
          successChance = Math.min(0.72, 0.30 + 0.21 * (powerRatio - 1));
      }

      let warningMsg = '';
      if      (powerRatio < 0.5)  warningMsg = `\n⚠️ *Danger:* Your target is far stronger — nearly hopeless.`;
      else if (powerRatio < 1.0)  warningMsg = `\n⚠️ Your target is stronger — this is risky.`;
      else if (powerRatio >= 2.5) warningMsg = `\n💪 Outmatched them completely.`;

      acc.crimeLevel = Math.min(100, (acc.crimeLevel || 0) + 15);
      acc.lastRob    = now();

      // Pet flavour line
      const robPetLine = (() => {
          if (!acc.pet?.type) return '';
          const petLvl  = acc.pet.level || 1;
          const petNick = acc.pet.nickname || null;
          const lvlTag  = petLvl > 1 ? ` (Lv${petLvl})` : '';
          const n       = petNick ? `${petNick}` : null;
          const PET_ROB_LINES = {
              dog:     `🐶 ${n || `Your Dog${lvlTag}`} growled at the target — they froze up!`,
              cat:     `🐱 ${n || `Your Cat${lvlTag}`} darted at their ankles — perfect distraction!`,
              parrot:  `🦜 ${n || `Your Parrot${lvlTag}`} screamed in their face — chaos ensued!`,
              penguin: `🐧 ${n || `Your Penguin${lvlTag}`} waddled menacingly between you and the target.`,
              wolf:    `🐺 ${n || `Your Wolf${lvlTag}`} circled the target — they were too scared to resist.`,
              bear:    `🐻 ${n || `Your Bear${lvlTag}`} rose up and roared — target surrendered immediately.`,
              shark:   `🦈 ${n || `Your Shark${lvlTag}`}... somehow appeared. The target ran.`,
              dragon:  `🐉 ${n || `Your Dragon${lvlTag}`} breathed fire. They handed over everything.`,
          };
          return '\n' + (PET_ROB_LINES[acc.pet.type] || '');
      })();

      if (Math.random() < successChance) {
          const pct        = 0.10 + Math.random() * 0.20;
          const stealGross = Math.floor(victim.money * pct);
          const { net: stolen, vat } = applyVAT(stealGross);
          victim.money -= stealGross;
          acc.money    += stolen;
          acc.crimesCommitted = (acc.crimesCommitted || 0) + 1;
          addTaxableIncome(acc, stolen);
          logFinancial(acc,    `Robbed @${targetId}`,     stolen);
          logFinancial(victim, `Robbed by @${acc._id}`, -stealGross);
          await saveAccount(victim);
          await saveAccount(acc);
          return conn.sendMessage(m.chat, {
              text: `🦹 *ROB SUCCESS!*${usedStr}${robPetLine}${warningMsg}\n\nTook ${fmtMoney(stealGross)} from @${targetId}\n🏛️ VAT -${fmtMoney(vat)} = *${fmtMoney(stolen)} net*\n🔥 Heat: ${crimeLevelBar(acc.crimeLevel)}`,
              mentions: [toJid(targetId)]
          }, { quoted: mek });
      } else {
          if (Math.random() < 0.40) {
              const fine = Math.min(acc.money, 500 + Math.floor(Math.random() * 1000));
              acc.jailedUntil = now() + 15 * 60 * 1000;
              acc.money -= fine;
              await saveAccount(acc);
              return reply(`🚔 *BUSTED!*${usedStr}${warningMsg}\n\nCops caught you. Fined ${fmtMoney(fine)} + 15 min jail.`);
          } else {
              const fine = Math.min(acc.money, 200 + Math.floor(Math.random() * 500));
              acc.money -= fine;
              await saveAccount(acc);
              return reply(`🚨 *ROB FAILED!*${usedStr}${warningMsg}\n\nTripped the alarm — dropped ${fmtMoney(fine)} escaping.`);
          }
      }
  } catch(e) { console.error('rob error', e); }
});

// CALL COPS — Report a high-crime player for arrest
cmd({ pattern: "callcops", desc: "callcops @user — Report a wanted criminal", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const callerId = await getPlayerId(conn, m.sender);
      const targetId = await getTargetId(conn, mek, args, 0);

      if (!targetId) return reply("Tag the player you want to report. Usage: callcops @user");
      if (targetId === callerId) return reply("You can't report yourself.");

      const caller = await getAccount(callerId);
      if (isHospitalized(caller)) return reply("You can't call the cops from jail/hospital.");

      // Per-caller cooldown: 5 minutes
      const COOLDOWN = 5 * 60 * 1000;
      const lastCall = (caller.cooldowns?.callcops || 0);
      if (now() - lastCall < COOLDOWN) return reply(`⏳ You already called the cops recently. Wait ${msToTime(COOLDOWN - (now() - lastCall))}.`);

      const target = await getAccount(targetId);
      const heat = target.crimeLevel || 0;

      caller.cooldowns = caller.cooldowns || {};
      caller.cooldowns.callcops = now();
      await saveAccount(caller);

      if (heat < 20) {
          return conn.sendMessage(m.chat, {
              text: `👮 You reported @${targetId} to the police.\n\nThe cops checked them out but their crime heat is too low (${heat}/100). No grounds for arrest.`,
              mentions: [toJid(targetId)]
          }, { quoted: mek });
      }

      // Arrest chance scales with heat level
      const arrestChance = Math.min(0.90, 0.30 + (heat - 20) * 0.0075);
      const arrested = Math.random() < arrestChance;

      if (arrested) {
          // Jail time proportional to crime heat (1 min per 2 heat points, min 5 min)
          const jailMs = Math.max(5 * 60 * 1000, Math.floor(heat * 30000)); // heat * 30s, max ~50min at 100
          target.jailedUntil = now() + jailMs;
          target.crimeLevel = 0;
          target.lastCrimeLevelDecay = now();

          // Caller gets a reward
          // Informant reward scales heavily with how hot the criminal was
          const reward = 1000 + Math.floor(Math.random() * 2000) + Math.floor(heat * 50);
          caller.money = (caller.money || 0) + reward;
          await saveAccount(target);
          await saveAccount(caller);

          return conn.sendMessage(m.chat, {
              text: `🚔 *ARREST MADE!*\n\n@${callerId} tipped off the cops about @${targetId}!\n\nThe police caught them with a crime heat of 🔴 ${heat}/100.\n\n⛓️ @${targetId} has been jailed for ${msToTime(jailMs)}.\n💰 Informant reward: *${fmtMoney(reward)}* 🎉`,
              mentions: [toJid(callerId), toJid(targetId)]
          }, { quoted: mek });
      } else {
          // Failed arrest — target gets a small heat reduction (they got lucky this time)
          target.crimeLevel = Math.max(0, heat - 15);
          await saveAccount(target);

          return conn.sendMessage(m.chat, {
              text: `👮 *REPORT FILED — ESCAPED!*\n\n@${callerId} tipped off the police about @${targetId} (Heat: 🟠 ${heat}/100).\n\nThe cops responded but @${targetId} slipped away. Their heat cooled slightly.`,
              mentions: [toJid(callerId), toJid(targetId)]
          }, { quoted: mek });
      }
  } catch(e) { console.error(e); }
});

// BLACKMARKET
cmd({ pattern: "blackmarket", desc: "View underworld items", category: "rpg", filename: __filename }, async (conn, mek, m, { reply }) => {
  let out = "🌑 *THE BLACKMARKET*\n_No questions asked._\n\n";
  for (const k of Object.keys(BLACKMARKET)) {
      out += `• *${k}* — ${fmtMoney(BLACKMARKET[k].price)}\n  ↳ _${BLACKMARKET[k].desc}_\n\n`;
  }
  out += "*Command:* deal <item>";
  return reply(out);
});

cmd({ pattern: "deal", desc: "buy from blackmarket", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const item = (args[0] || "").toLowerCase();
      if (!BLACKMARKET[item]) return reply("Item not found in the blackmarket.");

      const id = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);

      const bmPrice = Math.ceil(BLACKMARKET[item].price * (global.ECON_INDEX ?? 1.0));
      if (acc.money < bmPrice) return reply(`You don't have enough cash. Costs ${fmtMoney(bmPrice)}.`);

      acc.money -= bmPrice;
      acc.moneySpent = (acc.moneySpent || 0) + bmPrice;
      acc.inventory[item] = (acc.inventory[item] || 0) + 1;

      await saveAccount(acc);
      return reply(`🤝 Deal done. You purchased 1x *${item}* for ${fmtMoney(bmPrice)}.`);
  } catch(e) { console.error(e); }
});

// INVEST
cmd({ pattern: "invest", desc: "invest <amount> [1h|6h|24h]", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const senderId   = await getPlayerId(conn, m.sender);
      const CREATOR_ID = '2348084644182';
      let id = senderId;
      if (senderId === CREATOR_ID) {
          const t = await getTargetId(conn, mek, args, 0).catch(() => null);
          if (t && t !== senderId) id = t;
      }
      const acc = await getAccount(id);
      if (id === senderId && isHospitalized(acc)) return reply(`🚨 You are incarcerated.`);
      if (id === senderId && isKidnapped(acc)) return reply(`🔒 You are kidnapped.`);

      const amount = parseInt(args[0]);
      if (!amount || amount <= 0) return reply("Usage: invest <amount> [1h|6h|24h]");
      if (acc.money < amount) return reply(`Not enough wallet balance. Have: ${fmtMoney(acc.money)}`);

      const term = args[1] === "1h" ? 3600000 : args[1] === "6h" ? 6*3600000 : 24*3600000;
      const econM = Math.max(0.4, Math.min(2.0, global.ECON_INDEX ?? 1.0));
      const rate = term === 3600000 ? +(0.05 * econM).toFixed(4) : term === 6*3600000 ? +(0.18 * econM).toFixed(4) : +(0.5 * econM).toFixed(4);
      const econLabel2 = econM > 1.3 ? ' 📈 (bull market!)' : econM < 0.7 ? ' 📉 (bear market)' : '';

      acc.money -= amount;
      acc.investments.push({ amount, boughtAt: now(), termMs: term, rate });
      await saveAccount(acc);
      return reply(`📈 ${id!==senderId?`Invested for @${id}: `:''}${fmtMoney(amount)} in Wall Street for ${term===3600000?"1h":term===6*3600000?"6h":"24h"} at ${(rate*100).toFixed(1)}% yield.${econLabel2}`);
  } catch(e) { console.error(e); }
});

cmd({ pattern: "claim", desc: "Claim mature investments", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const senderId   = await getPlayerId(conn, m.sender);
      const CREATOR_ID = '2348084644182';
      let id = senderId;
      if (senderId === CREATOR_ID) {
          const t = await getTargetId(conn, mek, args, 0).catch(() => null);
          if (t && t !== senderId) id = t;
      }
      const acc = await getAccount(id);
      const nowTs = now();
      const matured = [], remaining = [];
      for (const inv of acc.investments || []) {
        if (nowTs - inv.boughtAt >= inv.termMs) matured.push(inv);
        else remaining.push(inv);
      }
      if (matured.length === 0) return reply(`📈 ${id!==senderId?`@${id} has`:'You have'} no mature investments to claim yet.`);
      let total = 0;
      for (const i of matured) total += Math.floor(i.amount * (1 + i.rate));
      acc.money += total;
      addTaxableIncome(acc, total);
      acc.investments = remaining;
      await saveAccount(acc);
      return reply(`💸 ${id!==senderId?`Claimed for @${id}: `:''}Wall Street paid out *${fmtMoney(total)}*!`);
  } catch(e) { console.error(e); }
});

// WAGER
cmd({ pattern: "wager", desc: "wager <amount>", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);
      if (isHospitalized(acc)) return reply(`🚨 You cannot gamble right now.`);
      if (isKidnapped(acc)) return reply(`🔒 You are kidnapped. Escape first.`);

      const amount = parseInt(args[0]);
      if (!amount || amount <= 0) return reply("Usage: wager <amount>");
      if (acc.money < amount) return reply("Not enough balance.");

      const COOLDOWN = 5*60*1000;
      const last = acc.cooldowns?.wager || 0;
      if (now() - last < COOLDOWN) return reply(`⏳ Wait ${msToTime(COOLDOWN - (now() - last))} before tossing the dice again.`);

      let winChance = 0.45;
      let charmMsg = '';

      if (acc.inventory['luckycharm'] && acc.inventory['luckycharm'] > 0) {
          winChance = 0.70;
          acc.inventory['luckycharm'] -= 1;
          charmMsg = `\n🍀 Your Lucky Charm glowed and was consumed!`;
      }

      acc.cooldowns = acc.cooldowns || {};
      acc.cooldowns.wager = now();

      if (Math.random() < winChance) {
        const profit = Math.floor(amount * (1 + Math.random()*1.5));
        acc.money += profit;
        addTaxableIncome(acc, profit);
        await saveAccount(acc);
        return reply(`🎲 *WINNER!* The dice rolled your way. You won ${fmtMoney(profit)}!${charmMsg}`);
      } else {
        acc.money -= amount;
        await saveAccount(acc);
        return reply(`💀 *BUST!* Snake eyes. You lost ${fmtMoney(amount)}.${charmMsg}`);
      }
  } catch(e) { console.error(e); }
});

// WIRE
cmd({ pattern: "wire", desc: "wire @user <amount>", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const senderId   = await getPlayerId(conn, m.sender);
      const CREATOR_ID = '2348084644182';

      // Creator: wire @from @to <amount>  OR normal: wire @to <amount>
      let fromId   = senderId;
      let targetId = await getTargetId(conn, mek, args, 0);
      let amountRaw = args[args.length - 1];

      if (senderId === CREATOR_ID && args.length >= 3) {
          // Try to parse wire @from @to <amount>
          const secondTarget = await getTargetId(conn, mek, args, 1).catch(() => null);
          if (secondTarget && secondTarget !== targetId) {
              fromId   = targetId;   // first mention = sender
              targetId = secondTarget; // second mention = recipient
          }
      }

      const amount = parseInt(amountRaw);
      if (!targetId || isNaN(amount) || amount <= 0) return reply(`Usage: wire @user <amount>${senderId===CREATOR_ID?' | wire @from @to <amount> (creator)':''}`);
      if (targetId === fromId) return reply("Cannot wire to yourself.");

      const acc = await getAccount(fromId);
      const rec = await getAccount(targetId);
      const isCreatorAction = fromId !== senderId;

      if (!isCreatorAction && isHospitalized(acc)) return reply(`🚨 Action restricted.`);
      if (!isCreatorAction && isKidnapped(acc)) return reply(`🔒 You are kidnapped.`);
      if (acc.money < amount) return reply(`Insufficient funds. @${fromId} has ${fmtMoney(acc.money)}.`);

      acc.money -= amount;
      rec.money += amount;
      logFinancial(acc, `Wire sent → @${targetId}${isCreatorAction?' (creator)':''}`, -amount);
      logFinancial(rec, `Wire received ← @${fromId}${isCreatorAction?' (creator)':''}`, amount);

      await saveAccount(acc); await saveAccount(rec);
      return conn.sendMessage(m.chat, { text: `💸 ${isCreatorAction?`👑 Creator wired `:''}${fmtMoney(amount)} from @${fromId} to @${targetId}.`, mentions: [toJid(fromId), toJid(targetId)] }, { quoted: mek });
  } catch(e) { console.error(e); }
});

// STATEMENT — Last 20 financial transactions
cmd({ pattern: "statement", desc: "View last 20 financial transactions", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const senderId = await getPlayerId(conn, m.sender);
      const CREATOR_ID = '2348084644182';

      // Creator can view any player's statement
      let id = senderId;
      if (senderId === CREATOR_ID) {
          const targetId = await getTargetId(conn, mek, args, 0).catch(() => null);
          if (targetId && targetId !== senderId) id = targetId;
      }

      const acc = await getAccount(id);
      const hist = acc.financialHistory || [];

      if (hist.length === 0) {
          return reply(`📊 ${id === senderId ? 'Your' : `@${id}'s`} financial statement is empty. Make some transactions first.`);
      }

      const label = id === senderId ? (acc.username || `@${id}`) : `@${id} 👑`;
      const lines = [...hist].reverse().join('\n');
      return conn.sendMessage(m.chat, {
          text: `📊 *Financial Statement — ${label}*\n_Last ${hist.length} transactions_\n\n${lines}`,
          mentions: id !== senderId ? [toJid(id)] : []
      }, { quoted: mek });
  } catch(e) { console.error(e); }
});

// LEADERBOARD
cmd({ pattern: "econboard", desc: "Show economy leaderboard", category: "rpg", filename: __filename }, async (conn, mek, m, { reply }) => {
  try {
      const db = await connectDB();
      const rows = await db.collection("weirdo_rpg").find({}).toArray();
      if (!rows || rows.length === 0) return reply("No economy data yet.");

      const scored = rows.map(r => {
        let nw = (r.money || 0) + (r.bank || 0);
        return { id: r._id, user: r.username || r._id, score: nw };
      }).sort((a,b) => b.score - a.score).slice(0, 10);

      let out = "🏆 *GLOBAL ECONOMY BOARD*\n_(Ranked by Wallet + Bank)_\n\n";
      const mentions = [];

      for (let i=0; i<scored.length; i++) {
        mentions.push(toJid(scored[i].id));
        out += `${i+1}. @${scored[i].id} — ${fmtMoney(scored[i].score)}\n`;
      }
      return conn.sendMessage(m.chat, { text: out, mentions }, { quoted: mek });
  } catch(e) { console.error(e); }
});

// STASH
async function handleStashCmd(conn, mek, m, { reply }) {
  try {
      const id = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);

      let invText = "Empty";
      if (acc.inventory) {
          const keys = Object.keys(acc.inventory).filter(k => acc.inventory[k] > 0);
          if (keys.length > 0) {
              invText = keys.map(k => `${k} x${acc.inventory[k]}`).join("\n");
          }
      }

      return reply(`🎒 *Your Stash:*\n\n${invText}`);
  } catch(e) { console.error(e); }
}
cmd({ pattern: 'stash',   desc: 'View your inventory',          category: 'rpg', filename: __filename }, handleStashCmd);
cmd({ pattern: 'econinv', desc: 'View inventory (alias: stash)', category: 'rpg', filename: __filename }, handleStashCmd);

// BAILOUT
cmd({ pattern: "bailout", desc: "Bribe cops to reduce prison time", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);

      if (!acc.jailedUntil || acc.jailedUntil <= now() || acc.health <= 0) return reply("You are not currently in prison.");

      const amount = parseInt(args[0]||"0");
      if (isNaN(amount) || amount <= 0) return reply(`⛓️ In prison for ${msToTime(acc.jailedUntil - now())}.\n\n*Bribe Cops:* bailout <amount>\n_( ${fmtMoney(iC(500))} removes 1 minute )_`);

      if (acc.money < amount) return reply("Not enough balance to pay the bribe.");

      const reduceMs = Math.floor(amount / iC(500)) * 60 * 1000;
      acc.money -= amount;
      acc.jailedUntil = Math.max(now(), acc.jailedUntil - reduceMs);

      await saveAccount(acc);
      if (acc.jailedUntil <= now()) {
          return reply(`🚔 You paid a ${fmtMoney(amount)} bribe and were released immediately!`);
      } else {
          return reply(`🚔 You paid ${fmtMoney(amount)}. Remaining sentence: ${msToTime(acc.jailedUntil - now())}`);
      }
  } catch(e) { console.error(e); }
});

// PAY MEDS
cmd({ pattern: "paymeds", desc: "Pay private docs to heal instantly", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);

      if (acc.health > 0 && (!acc.jailedUntil || acc.jailedUntil <= now())) return reply("You don't need emergency medical care.");
      if (acc.health > 0 && acc.jailedUntil > now()) return reply("You are in PRISON, not the hospital. Use 'bailout'.");

      const amount = parseInt(args[0]||"0");
      if (isNaN(amount) || amount <= 0) return reply(`🏥 Hospitalized for ${msToTime(acc.jailedUntil - now())}.\n\n*Pay Private Doctors:* paymeds <amount>\n_( ${fmtMoney(iC(1000))} removes 1 minute )_`);

      if (acc.money < amount) return reply("Not enough balance to pay medical bills.");

      const reduceMs = Math.floor(amount / iC(1000)) * 60 * 1000;
      acc.money -= amount;
      acc.jailedUntil = Math.max(now(), acc.jailedUntil - reduceMs);

      if (acc.jailedUntil <= now()) {
          acc.health = acc.maxHealth;
          await saveAccount(acc);
          return reply(`🏥 You paid ${fmtMoney(amount)} for experimental surgery. You are fully healed and discharged!`);
      } else {
          await saveAccount(acc);
          return reply(`🏥 You paid ${fmtMoney(amount)}. Remaining recovery time: ${msToTime(acc.jailedUntil - now())}`);
      }
  } catch(e) { console.error(e); }
});

// GANG ROB — Organised crime: multiple players gang up on one target, split loot
// Usage: gangrob @target   — initiates or joins an active gang rob in your city
// How it works:
//   • First person to run gangrob @target opens a 3-minute window
//   • Anyone in the same city can join within that window (max 5 attackers)
//   • After 3 min (or when 5 members join) the creator runs  gangrob go  to execute
//   • Combined attacker power is pooled — easy to overpower even strong targets
//   • Loot split equally after VAT; each participant heat +10
const gangRobSessions = new Map(); // targetId → { attackers: [id,...], openUntil, from }

cmd({ pattern: "gangrob", desc: "gangrob @target | gangrob go — Organised mugging", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const senderId  = await getPlayerId(conn, m.sender);
      const senderAcc = await getAccount(senderId);
      const from      = m.chat;

      if (isHospitalized(senderAcc)) return reply(`🚨 You're hospitalized. Can't gang rob.`);
      if (isKidnapped(senderAcc))    return reply(`🔒 You're kidnapped.`);
      if (isInFlight(senderAcc))     return reply(`✈️ You're in-flight.`);

      const subCmd = (args[0] || '').toLowerCase();

      // ── EXECUTE: gangrob go ───────────────────────────────────────────────
      if (subCmd === 'go') {
          // Find session where this sender is the organiser (first in list)
          let session = null, sessionTargetId = null;
          for (const [tid, s] of gangRobSessions.entries()) {
              if (s.attackers[0] === senderId) { session = s; sessionTargetId = tid; break; }
          }
          if (!session) return reply(`❌ You don't have an open gang rob session.\nStart one with: gangrob @target`);
          if (session.openUntil < now()) {
              gangRobSessions.delete(sessionTargetId);
              return reply(`⏰ Your gang rob session expired. Start a new one.`);
          }
          if (session.attackers.length < 2) return reply(`👥 Need at least 2 attackers. Wait for more to join.`);

          const victim = await getAccount(sessionTargetId);
          if (!victim.money || victim.money <= 100) {
              gangRobSessions.delete(sessionTargetId);
              return reply(`😂 Target is broke. Victim has nothing worth taking.`);
          }
          if (victim.robImmunityUntil && victim.robImmunityUntil > now()) {
              gangRobSessions.delete(sessionTargetId);
              return reply(`🛡️ *${victim.username || sessionTargetId}* just activated rob protection! Session cancelled.`);
          }

          // Pool all attacker power
          let totalAtkPower = 0;
          const attackerAccounts = [];
          for (const aid of session.attackers) {
              const a = await getAccount(aid);
              const g = getEconGearBonus(a);
              totalAtkPower += (a.strength || 3) + (a.speed || 3) + g.atkBonus + g.strBonus + g.spdBonus;
              attackerAccounts.push(a);
          }

          const vicGear  = getEconGearBonus(victim);
          const defPower = (victim.strength || 3) + (victim.defense || 3)
                         + vicGear.defBonus + vicGear.strBonus + vicGear.dexBonus
                         + (victim.equippedWeapon && (victim.ammo||0) > 0 ? 45 : victim.equippedWeapon ? 20 : 0);

          const ratio   = totalAtkPower / Math.max(1, defPower);
          // Pooled attackers get a generous success curve
          const chance  = Math.min(0.92, 0.40 + 0.25 * (ratio - 1));

          // Apply heat + cooldown to all attackers regardless of outcome
          for (const a of attackerAccounts) {
              a.crimeLevel = Math.min(100, (a.crimeLevel || 0) + 10);
              a.lastRob    = now();
          }

          gangRobSessions.delete(sessionTargetId);
          const mentions = session.attackers.map(toJid).concat([toJid(sessionTargetId)]);

          if (Math.random() < chance) {
              const pct        = 0.15 + Math.random() * 0.20; // 15–35% loot
              const totalGross = Math.floor(victim.money * pct);
              const { net: totalNet, vat } = applyVAT(totalGross);
              const perPerson  = Math.floor(totalNet / attackerAccounts.length);

              victim.money -= totalGross;
              logFinancial(victim, `Gang-robbed by ${attackerAccounts.length} players`, -totalGross);
              await saveAccount(victim);

              let resultLines = `🦹‍♂️ *GANG ROB SUCCESS!*\n👥 ${attackerAccounts.length} attackers vs @${sessionTargetId}\n\nStole ${fmtMoney(totalGross)} — VAT -${fmtMoney(vat)} = *${fmtMoney(totalNet)} net*\n💰 Each attacker gets: *${fmtMoney(perPerson)}*\n\n`;
              for (const a of attackerAccounts) {
                  a.money += perPerson;
                  a.crimesCommitted = (a.crimesCommitted || 0) + 1;
                  addTaxableIncome(a, perPerson);
                  logFinancial(a, `Gang rob cut vs @${sessionTargetId}`, perPerson);
                  await saveAccount(a);
                  resultLines += `• @${a._id}: +${fmtMoney(perPerson)}\n`;
              }
              return conn.sendMessage(from, { text: resultLines, mentions }, { quoted: mek });
          } else {
              // Failed — all attackers get fined / chance to be jailed
              let resultLines = `🚔 *GANG ROB BUSTED!*\n👮 The target called the cops on all of you!\n\n`;
              for (const a of attackerAccounts) {
                  if (Math.random() < 0.5) {
                      const fine = Math.min(a.money, 300 + Math.floor(Math.random() * 700));
                      a.money -= fine;
                      a.jailedUntil = now() + 10 * 60 * 1000;
                      resultLines += `• @${a._id}: Jailed 10min + fined ${fmtMoney(fine)}\n`;
                  } else {
                      const fine = Math.min(a.money, 100 + Math.floor(Math.random() * 300));
                      a.money -= fine;
                      resultLines += `• @${a._id}: Escaped but dropped ${fmtMoney(fine)}\n`;
                  }
                  await saveAccount(a);
              }
              return conn.sendMessage(from, { text: resultLines, mentions }, { quoted: mek });
          }
      }

      // ── JOIN: if there's an active session for this target, join it ───────
      const targetId = await getTargetId(conn, mek, args, 0);
      if (!targetId) return reply(`Usage:\n• *gangrob @target* — start or join a gang rob\n• *gangrob go* — execute when ready (organiser only)`);
      if (targetId === senderId) return reply("You can't rob yourself.");

      const myCity     = normLoc(senderAcc.location);
      const victim2    = await getAccount(targetId);
      const victimCity = normLoc(victim2.location);
      if (myCity !== victimCity) {
          return reply(`🌍 Target is in *${victim2.location || 'Weirdos World'}* — you're in *${senderAcc.location || 'Weirdos World'}*. Travel there first.`);
      }

      // Check if there's an existing session for this target
      if (gangRobSessions.has(targetId)) {
          const s = gangRobSessions.get(targetId);
          if (s.openUntil < now()) {
              gangRobSessions.delete(targetId); // expired, start fresh below
          } else if (s.attackers.includes(senderId)) {
              return reply(`✅ You're already in this gang rob. Organiser runs *gangrob go* to execute.\n👥 Current crew: ${s.attackers.length}/5`);
          } else if (s.attackers.length >= 5) {
              return reply(`👥 That gang rob already has 5 attackers (max). Full crew.`);
          } else {
              s.attackers.push(senderId);
              return conn.sendMessage(from, {
                  text: `🤝 @${senderId} joined the gang rob against @${targetId}!\n👥 Crew: ${s.attackers.length}/5 | ${msToTime(s.openUntil - now())} left\n\nOrganiser (@${s.attackers[0]}): run *gangrob go* when ready.`,
                  mentions: [toJid(senderId), toJid(targetId), toJid(s.attackers[0])]
              }, { quoted: mek });
          }
      }

      // ── START: open a new session ─────────────────────────────────────────
      const COOLDOWN = 20 * 60 * 1000;
      if (now() - (senderAcc.lastRob || 0) < COOLDOWN)
          return reply(`⏳ Rob cooldown: ${msToTime(COOLDOWN - (now() - (senderAcc.lastRob||0)))} left.`);
      if (!victim2.money || victim2.money <= 100) return reply("Target is broke — nothing to steal.");

      gangRobSessions.set(targetId, {
          attackers: [senderId],
          openUntil: now() + 3 * 60 * 1000,
          from
      });

      // Auto-expire after 3 minutes
      setTimeout(() => { gangRobSessions.delete(targetId); }, 3 * 60 * 1000);

      return conn.sendMessage(from, {
          text: `🦹 *Gang Rob Initiated!*\n\nTarget: @${targetId} (in *${victim2.location || 'Weirdos World'}*)\n👥 Crew: 1/5\n⏳ Window: 3 minutes\n\n*Others in ${senderAcc.location || 'Weirdos World'} can join with:*\ngangrob @${targetId}\n\nOrganiser runs *gangrob go* when ready.`,
          mentions: [toJid(targetId)]
      }, { quoted: mek });

  } catch(e) { console.error('gangrob error', e); }
});

// TOGGLE DRAINS — Creator only: flip hourly economy drains on/off, persistent
// =============================================================================
// GANG ATTACK & DEFEND
// Usage: gangattack @target — start/join a gang attack on someone
//        gangattack go      — execute when ready (organiser only)
//        defend @player     — join the defence of someone being gang attacked
// How it works:
//   • Attacker opens a 3-min window. Others join with gangattack @target
//   • Defender and their allies join with defend @target
//   • On 'gangattack go': combined attacker power vs combined defender power
//   • Winner takes 15–30% of target's wallet. Losers get fined/jailed.
// =============================================================================
const gangAttackSessions = new Map(); // targetId → { attackers:[id,...], defenders:[id,...], openUntil, from }

cmd({ pattern: "gangattack", desc: "gangattack @target | gangattack go — Organised gang attack", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const senderId  = await getPlayerId(conn, m.sender);
      const senderAcc = await getAccount(senderId);
      const from      = m.chat;

      if (isHospitalized(senderAcc)) return reply(`🚨 You're hospitalized. Can't attack.`);
      if (isKidnapped(senderAcc))    return reply(`🔒 You're kidnapped.`);
      if (isInFlight(senderAcc))     return reply(`✈️ You're in-flight.`);

      const subCmd = (args[0] || '').toLowerCase();

      // ── EXECUTE ───────────────────────────────────────────────────────────
      if (subCmd === 'go') {
          let session = null, sessionTargetId = null;
          for (const [tid, s] of gangAttackSessions.entries()) {
              if (s.attackers[0] === senderId) { session = s; sessionTargetId = tid; break; }
          }
          if (!session) return reply(`❌ You don't have an open gang attack. Start one: gangattack @target`);
          if (session.openUntil < now()) { gangAttackSessions.delete(sessionTargetId); return reply(`⏰ Session expired.`); }
          if (session.attackers.length < 2) return reply(`👥 Need at least 2 attackers. Wait for others to join.`);

          const victim = await getAccount(sessionTargetId);
          if (!victim.money || victim.money <= 100) { gangAttackSessions.delete(sessionTargetId); return reply(`😂 Target is broke. Nothing worth taking.`); }

          // Load all accounts
          const attackerAccs = await Promise.all(session.attackers.map(id => getAccount(id)));
          const defenderAccs = await Promise.all(session.defenders.map(id => getAccount(id)));

          // Calculate total power for each side
          function calcPower(accs) {
              return accs.reduce((total, a) => {
                  const lm  = 1 + ((a.level || 1) - 1) * 0.08;
                  const g   = getEconGearBonus(a);
                  const pet = getPetBonus(a);
                  return total + ((a.strength||3)*0.45 + (a.dexterity||3)*0.25 + (a.speed||3)*0.20 + (a.defense||3)*0.10 + g.atkBonus + g.strBonus + (pet.strBonus||0) + (pet.spdBonus||0)) * lm;
              }, 0);
          }

          const atkPower = calcPower(attackerAccs);
          const defPower = calcPower([victim, ...defenderAccs]);
          const ratio    = atkPower / Math.max(1, defPower);
          // ±15% RNG
          const atkRoll  = atkPower * (0.85 + Math.random() * 0.30);
          const defRoll  = defPower * (0.85 + Math.random() * 0.30);
          const atkWon   = atkRoll > defRoll;

          gangAttackSessions.delete(sessionTargetId);
          const mentions = [...session.attackers, ...session.defenders, sessionTargetId].map(toJid);

          const powerBar = (pow, total) => { const n = Math.min(10, Math.round((pow/Math.max(1,total))*10)); return '█'.repeat(n)+'░'.repeat(10-n); };
          const total = atkPower + defPower;

          let resultLines = [
              `⚔️ *GANG ATTACK — RESULT*`,
              ``,
              `🔴 *Attackers* (${session.attackers.length}) — Power: ${Math.floor(atkPower).toLocaleString()}  ${powerBar(atkPower, total)}`,
              `🔵 *Defenders* (${session.defenders.length+1}) — Power: ${Math.floor(defPower).toLocaleString()}  ${powerBar(defPower, total)}`,
              ``,
          ];

          if (atkWon) {
              const pct      = 0.15 + Math.random() * 0.15;
              const gross    = Math.floor(victim.money * pct);
              const { net, vat } = applyVAT(gross);
              const perPerson = Math.floor(net / attackerAccs.length);
              victim.money  -= gross;
              logFinancial(victim, `Gang attacked by ${attackerAccs.length} players`, -gross);
              await saveAccount(victim);
              for (const a of attackerAccs) {
                  a.money += perPerson;
                  a.crimeLevel = Math.min(100, (a.crimeLevel||0) + 15);
                  a.crimesCommitted = (a.crimesCommitted||0) + 1;
                  logFinancial(a, `Gang attack cut vs @${sessionTargetId}`, perPerson);
                  await saveAccount(a);
              }
              resultLines.push(`🏆 *ATTACKERS WIN!*`);
              resultLines.push(`💰 Looted ${fmtMoney(gross)} — VAT -${fmtMoney(vat)} = *${fmtMoney(net)} net*`);
              resultLines.push(`💵 Each attacker gets: *${fmtMoney(perPerson)}*`);
              if (defenderAccs.length > 0) resultLines.push(`🛡️ Defenders fought bravely but couldn't hold them off.`);
          } else {
              resultLines.push(`🛡️ *DEFENCE HOLDS!*`);
              resultLines.push(defenderAccs.length > 0 ? `@${sessionTargetId} and their allies repelled the attack!` : `@${sessionTargetId} held their ground alone!`);
              // Attackers get fined/jailed
              for (const a of attackerAccs) {
                  const fine = Math.min(a.money, 300 + Math.floor(Math.random()*700));
                  a.money -= fine;
                  if (Math.random() < 0.5) a.jailedUntil = now() + 10*60*1000;
                  a.crimeLevel = Math.min(100, (a.crimeLevel||0) + 20);
                  logFinancial(a, `Gang attack failed — fined`, -fine);
                  await saveAccount(a);
              }
              resultLines.push(`💸 All attackers fined and some jailed.`);
          }

          return conn.sendMessage(from, { text: resultLines.join('\n'), mentions }, { quoted: mek });
      }

      // ── START / JOIN ──────────────────────────────────────────────────────
      const targetId = await getTargetId(conn, mek, args, 0);
      if (!targetId) return reply(`Usage:\n• *gangattack @target* — start or join a gang attack\n• *gangattack go* — execute (organiser only)\n• *defend @player* — defend someone being attacked`);
      if (targetId === senderId) return reply(`You can't attack yourself.`);

      const myCity  = normLoc(senderAcc.location);
      const victim  = await getAccount(targetId);
      const vicCity = normLoc(victim.location);
      if (myCity !== vicCity) return reply(`🌍 Target is in *${vicCity}* — you're in *${myCity}*. Travel there first.`);
      if (!victim.money || victim.money <= 100) return reply(`Target is broke. Nothing worth taking.`);

      // Check if target is already being defended — can still attack them
      if (gangAttackSessions.has(targetId)) {
          const s = gangAttackSessions.get(targetId);
          if (s.openUntil < now()) { gangAttackSessions.delete(targetId); }
          else if (s.attackers.includes(senderId)) return reply(`✅ You're already in this attack. Organiser runs *gangattack go*.`);
          else if (s.attackers.length >= 5) return reply(`👥 Attack crew is full (5/5).`);
          else {
              s.attackers.push(senderId);
              return conn.sendMessage(from, { text: `🔴 @${senderId} joined the gang attack on @${targetId}!\n👥 Attackers: ${s.attackers.length}/5 | Defenders: ${s.defenders.length}\n⏳ ${msToTime(s.openUntil - now())} left`, mentions: [toJid(senderId), toJid(targetId)] }, { quoted: mek });
          }
      }

      // Start new session
      const COOLDOWN = 20 * 60 * 1000;
      if (now() - (senderAcc.lastRob || 0) < COOLDOWN) return reply(`⏳ Rob cooldown: ${msToTime(COOLDOWN - (now()-(senderAcc.lastRob||0)))} left.`);

      gangAttackSessions.set(targetId, { attackers: [senderId], defenders: [], openUntil: now() + 3*60*1000, from });
      setTimeout(() => { gangAttackSessions.delete(targetId); }, 3*60*1000);

      return conn.sendMessage(from, {
          text: [`⚔️ *GANG ATTACK OPENED!*`, ``, `Target: @${targetId} (${vicCity})`, `👥 Attackers: 1/5 | 🛡️ Defenders: 0`, `⏳ 3-minute window`, ``, `*Join the attack:* gangattack @${targetId}`, `*Defend ${victim.username||targetId}:* defend @${targetId}`, ``, `Organiser runs *gangattack go* when ready.`].join('\n'),
          mentions: [toJid(targetId)]
      }, { quoted: mek });

  } catch(e) { console.error('gangattack error', e); }
});

cmd({ pattern: "defend", desc: "defend @player — join someone's defence against a gang attack", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const senderId  = await getPlayerId(conn, m.sender);
      const senderAcc = await getAccount(senderId);
      const from      = m.chat;

      if (isHospitalized(senderAcc)) return reply(`🚨 You're hospitalized.`);
      if (isKidnapped(senderAcc))    return reply(`🔒 You're kidnapped.`);
      if (isInFlight(senderAcc))     return reply(`✈️ You're in-flight.`);

      const targetId = await getTargetId(conn, mek, args, 0);
      if (!targetId) return reply(`Usage: defend @player\n\nJoins the defence of a player being gang attacked.`);
      if (targetId === senderId) return reply(`You're already defending yourself by being the target.`);

      if (!gangAttackSessions.has(targetId)) return reply(`@${targetId} is not currently under a gang attack. Nothing to defend.`);
      const s = gangAttackSessions.get(targetId);
      if (s.openUntil < now()) { gangAttackSessions.delete(targetId); return reply(`The attack window expired.`); }

      const myCity  = normLoc(senderAcc.location);
      const victim  = await getAccount(targetId);
      if (myCity !== normLoc(victim.location)) return reply(`🌍 You need to be in the same city as @${targetId} to defend them.`);
      if (s.attackers.includes(senderId)) return reply(`You're already on the attacking side. Pick a side.`);
      if (s.defenders.includes(senderId)) return reply(`✅ You're already defending @${targetId}.`);
      if (s.defenders.length >= 5) return reply(`🛡️ Defence is full (5 defenders).`);

      s.defenders.push(senderId);

      return conn.sendMessage(from, {
          text: [`🛡️ *@${senderId} is defending @${targetId}!*`, ``, `🔴 Attackers: ${s.attackers.length} | 🛡️ Defenders: ${s.defenders.length}`, `⏳ ${msToTime(s.openUntil - now())} left`, ``, `_More can join: defend @${targetId}_`].join('\n'),
          mentions: [toJid(senderId), toJid(targetId)]
      }, { quoted: mek });
  } catch(e) { console.error('defend error', e); }
});

cmd({ pattern: "toggledrains", desc: "[Creator] Toggle hourly economy drains on/off", category: "rpg", filename: __filename }, async (conn, mek, m, { reply }) => {
  try {
      const senderId   = await getPlayerId(conn, m.sender);
      const CREATOR_ID = '2348084644182';
      if (senderId !== CREATOR_ID) return reply(`❌ Creator-only command.`);
      global.weirdo_drains_enabled = !global.weirdo_drains_enabled;
      await saveGameConfig(); // ← persist to DB so toggle survives restarts
      const on = global.weirdo_drains_enabled;
      return reply([
          `⚙️ *Economy Drains: ${on ? '✅ ON' : '❌ OFF'}*`,
          `_Saved to database — survives bot restarts_`,
          ``,
          on
              ? `All hourly drains are now active:\n• Property tax\n• Wealth tax\n• Gear maintenance\n• Faction dues\n• Hospital discharge fees`
              : `All hourly drains suspended.\nBalances will not be drained until toggled back on.`
      ].join('\n'));
  } catch(e) { console.error('toggledrains error', e); }
});

// ECON DRAINS INFO — Anyone can check drain status
cmd({ pattern: "econdrains", desc: "Check if economy drains are active", category: "rpg", filename: __filename }, async (conn, mek, m, { reply }) => {
  try {
      const senderId = await getPlayerId(conn, m.sender);
      const acc      = await getAccount(senderId);
      const total    = (acc.money || 0) + (acc.bank || 0);
      const wRate    = getWealthTaxRate(total);

      let propTax = 0;
      for (const [pId, qty] of Object.entries(acc.properties || {})) {
          propTax += Math.ceil((DEFAULT_PROP_PRICES[pId] || 0) * PROPERTY_TAX_RATE * (qty || 0));
      }
      let gearCost = 0;
      for (const slot of ['equippedWeapon','equippedArmor','equippedHelmet','equippedGloves','equippedKneePads','equippedBoots']) {
          if (acc[slot]) gearCost += iC(GEAR_MAINTENANCE_BASE[getItemRarity(acc[slot])] || 200);
      }
      const wealthTax   = Math.ceil(total * wRate);
      const factionDues = acc.faction ? iC(FACTION_DUES_BASE) : 0;
      const totalDrain  = propTax + gearCost + wealthTax + factionDues;

      return reply([
          `📊 *Economy Drains: ${global.weirdo_drains_enabled ? '✅ ON' : '❌ OFF (suspended)'}*`,
          ``,
          `Your hourly costs:`,
          `🏠 Property tax:   ${fmtMoney(propTax)}/hr`,
          `🔧 Gear maint:     ${fmtMoney(gearCost)}/hr`,
          `💸 Wealth tax (${(wRate*100).toFixed(1)}%): ${fmtMoney(wealthTax)}/hr`,
          `🏢 Faction dues:   ${fmtMoney(factionDues)}/hr`,
          ``,
          `💀 Total drain: *${fmtMoney(totalDrain)}/hr*`,
          acc.gearInsurance
              ? `🛡️ Gear Insurance: Active`
              : `❌ No gear insurance — gear can be lost on death`
      ].join('\n'));
  } catch(e) { console.error('econdrains error', e); }
});


// =============================================================================
// LOTTERY — Global jackpot. Buy tickets, creator draws a winner.
// =============================================================================
if (!global.lottoJackpot) global.lottoJackpot = iC(50000);
if (!global.lottoTickets) global.lottoTickets = {}; // { playerId: ticketCount }

cmd({ pattern: "lotto", desc: "lotto buy [qty] | lotto draw | lotto status", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id      = await getPlayerId(conn, m.sender);
      const acc     = await getAccount(id);
      const sub     = (args[0] || 'status').toLowerCase();
      const CREATOR = '2348084644182';
      const TICKET_PRICE = iC(1000);

      if (sub === 'status') {
          const myTickets = global.lottoTickets[id] || 0;
          const totalTickets = Object.values(global.lottoTickets).reduce((a,b) => a+b, 0);
          const myChance = totalTickets > 0 ? ((myTickets / totalTickets) * 100).toFixed(1) : '0.0';
          return reply([
              `🎟️ *WEIRDOS WORLD LOTTERY*`,
              ``,
              `💰 Jackpot: *${fmtMoney(global.lottoJackpot)}*`,
              `🎫 Total tickets sold: ${totalTickets}`,
              ``,
              `Your tickets: *${myTickets}* (${myChance}% win chance)`,
              `Ticket price: ${fmtMoney(TICKET_PRICE)} each`,
              ``,
              `Buy with: *lotto buy <qty>*`,
              `_Creator draws the winner with: lotto draw_`
          ].join('\n'));
      }

      if (sub === 'draw') {
          if (id !== CREATOR) return reply(`❌ Only the creator can draw the lottery.`);
          const entries = [];
          for (const [pid, qty] of Object.entries(global.lottoTickets)) {
              for (let i = 0; i < qty; i++) entries.push(pid);
          }
          if (entries.length === 0) return reply(`🎟️ No tickets sold yet — no draw possible.`);

          const winnerId = entries[Math.floor(Math.random() * entries.length)];
          const winner   = await getAccount(winnerId);
          const prize    = global.lottoJackpot;

          winner.money += prize;
          logFinancial(winner, `🎟️ Lottery jackpot won!`, prize);
          await saveAccount(winner);

          const oldJackpot = global.lottoJackpot;
          global.lottoJackpot = iC(50000); // reset
          global.lottoTickets = {};

          return conn.sendMessage(m.chat, {
              text: [
                  `🎉 *LOTTERY DRAW!*`,
                  ``,
                  `${entries.length} tickets in the drum...`,
                  ``,
                  `🏆 WINNER: @${winnerId} (*${winner.username || winnerId}*)`,
                  `💰 Prize: *${fmtMoney(prize)}*`,
                  ``,
                  `Jackpot resets to ${fmtMoney(global.lottoJackpot)}.`,
                  `Buy tickets for the next round: lotto buy <qty>`
              ].join('\n'),
              mentions: [toJid(winnerId)]
          }, { quoted: mek });
      }

      if (sub === 'buy') {
          if (isHospitalized(acc)) return reply(`🚨 Can't buy tickets from jail/hospital.`);
          if (isKidnapped(acc))    return reply(`🔒 You're kidnapped. Escape first.`);
          const qty = Math.max(1, Math.min(100, parseInt(args[1]) || 1));
          const cost = TICKET_PRICE * qty;
          if (acc.money < cost) return reply(`Not enough cash. ${qty} ticket(s) = ${fmtMoney(cost)}. You have ${fmtMoney(acc.money)}.`);
          acc.money -= cost;
          acc.moneySpent = (acc.moneySpent || 0) + cost;
          logFinancial(acc, `Lottery tickets x${qty}`, -cost);
          await saveAccount(acc);
          global.lottoTickets[id] = (global.lottoTickets[id] || 0) + qty;
          global.lottoJackpot += Math.floor(cost * 0.8); // 80% of sales go to jackpot
          const total = global.lottoTickets[id];
          const allTickets = Object.values(global.lottoTickets).reduce((a,b) => a+b, 0);
          return reply([
              `🎟️ Bought *${qty} ticket(s)* for ${fmtMoney(cost)}`,
              `Your total: ${total} tickets (${((total/allTickets)*100).toFixed(1)}% chance)`,
              `Jackpot now: *${fmtMoney(global.lottoJackpot)}*`
          ].join('\n'));
      }

      return reply(`Usage: lotto status | lotto buy <qty> | lotto draw (creator)`);
  } catch(e) { console.error('lotto error', e); }
});

// =============================================================================
// SMUGGLE — Run contraband from your current location back to Weirdos World
// Can only be done when NOT already at Weirdos World. High risk, high reward.
// =============================================================================
cmd({ pattern: "smuggle", desc: "Run contraband for a big payout (not in Weirdos World)", category: "rpg", filename: __filename }, async (conn, mek, m, { reply }) => {
  try {
      const id  = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);

      if (isHospitalized(acc)) return reply(`🚨 You're locked up. Can't smuggle.`);
      if (isKidnapped(acc))    return reply(`🔒 You're kidnapped. Escape first.`);
      if (isInFlight(acc))     return reply(`✈️ You're in-flight. Wait until you land.`);

      const city = normLoc(acc.location).toLowerCase();
      if (city === 'weirdos world') {
          return reply([
              `🚫 *Smuggling requires you to be abroad.*`,
              ``,
              `Travel to Mexico, London, Japan, or Switzerland first.`,
              `Then run *smuggle* to carry contraband back to Weirdos World.`
          ].join('\n'));
      }

      const COOLDOWN = 45 * 60 * 1000;
      const last = acc.cooldowns?.smuggle || 0;
      if (now() - last < COOLDOWN) return reply(`⏳ Lay low for ${msToTime(COOLDOWN - (now()-last))} before smuggling again.`);

      // Reward scales with how far the city is
      const cityTiers = { mexico: 1, london: 2, japan: 3, switzerland: 4 };
      const tier = cityTiers[city] || 1;
      const baseReward = iC(20000) * tier;
      const failChance = 0.35 + (tier * 0.03); // harder cities = slightly riskier too

      acc.cooldowns = acc.cooldowns || {};
      acc.cooldowns.smuggle = now();
      acc.crimeLevel = Math.min(100, (acc.crimeLevel || 0) + 20);

      if (Math.random() > failChance) {
          const reward = Math.floor(baseReward + Math.random() * baseReward);
          const { net, vat } = applyVAT(reward);
          acc.money += net;
          addTaxableIncome(acc, net);
          logFinancial(acc, `Smuggling run from ${acc.location}`, net);
          await saveAccount(acc);
          return reply([
              `🧳 *SMUGGLE SUCCESSFUL!*`,
              ``,
              `You slipped through customs with a hot shipment from *${acc.location}*.`,
              `💰 Gross: ${fmtMoney(reward)} — VAT: -${fmtMoney(vat)} = *${fmtMoney(net)} net*`,
              `⚠️ Crime heat +20`,
              ``,
              `_You're still in ${acc.location}. Travel home when ready._`
          ].join('\n'));
      } else {
          const fine = Math.min(acc.money, iC(5000) * tier + Math.floor(Math.random() * iC(5000)));
          const jailTime = (10 + tier * 5) * 60 * 1000;
          acc.money -= fine;
          acc.jailedUntil = now() + jailTime;
          acc.health = Math.max(0, (acc.health || 100) - 15);
          logFinancial(acc, `Caught smuggling — fined`, -fine);
          await saveAccount(acc);
          return reply([
              `🚔 *BUSTED AT CUSTOMS!*`,
              ``,
              `Border patrol found your stash.`,
              `💸 Fine: ${fmtMoney(fine)}`,
              `⛓️ Jailed: ${msToTime(jailTime)}`,
              `❤️ -15 HP`,
              ``,
              `Use *bailout* to bribe your way out early.`
          ].join('\n'));
      }
  } catch(e) { console.error('smuggle error', e); }
});

// =============================================================================
// HITMAN — Pay to have an NPC crew jail your target for a while
// =============================================================================
cmd({ pattern: "hitman", desc: "hitman @player — pay to have someone jailed", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id       = await getPlayerId(conn, m.sender);
      const targetId = await getTargetId(conn, mek, args, 0);
      if (!targetId) return reply(`Usage: hitman @player\n\nPay a crew to go after someone and put them in hospital.`);
      if (targetId === id) return reply(`You can't send a hitman after yourself.`);

      const acc    = await getAccount(id);
      const target = await getAccount(targetId);

      if (isHospitalized(acc)) return reply(`🚨 You're locked up.`);
      if (isKidnapped(acc))    return reply(`🔒 You're kidnapped.`);

      const COST     = iC(50000);
      const COOLDOWN = 60 * 60 * 1000;
      const last     = acc.cooldowns?.hitman || 0;
      if (now() - last < COOLDOWN) return reply(`⏳ Your hitman crew needs ${msToTime(COOLDOWN - (now()-last))} to cool off.`);
      if (acc.money < COST) return reply(`💸 Hiring a hitman costs *${fmtMoney(COST)}*. You have ${fmtMoney(acc.money)}.`);

      acc.money -= COST;
      acc.moneySpent = (acc.moneySpent || 0) + COST;
      acc.cooldowns = acc.cooldowns || {};
      acc.cooldowns.hitman = now();
      acc.crimeLevel = Math.min(100, (acc.crimeLevel || 0) + 25);

      const SUCCESS_CHANCE = 0.65;
      if (Math.random() < SUCCESS_CHANCE) {
          // Hit lands
          const dmg      = 20 + Math.floor(Math.random() * 30);
          const jailTime = (15 + Math.floor(Math.random() * 20)) * 60 * 1000;
          target.health     = Math.max(0, (target.health || 100) - dmg);
          target.jailedUntil = Math.max(target.jailedUntil || 0, now() + jailTime);
          logFinancial(acc, `Hired hitman vs @${targetId}`, -COST);
          await saveAccount(acc);
          await saveAccount(target);
          return conn.sendMessage(m.chat, {
              text: [
                  `🔫 *HIT CONFIRMED*`,
                  ``,
                  `Your crew tracked down @${targetId}.`,
                  `❤️ They took ${dmg} damage`,
                  `⛓️ Hospitalised for ${msToTime(jailTime)}`,
                  ``,
                  `💸 You paid: ${fmtMoney(COST)}`
              ].join('\n'),
              mentions: [toJid(targetId)]
          }, { quoted: mek });
      } else {
          // Hit failed — target spotted your crew, you get heat
          acc.crimeLevel = Math.min(100, (acc.crimeLevel || 0) + 20);
          logFinancial(acc, `Hitman failed vs @${targetId} — fee lost`, -COST);
          await saveAccount(acc);
          return conn.sendMessage(m.chat, {
              text: [
                  `❌ *HIT FAILED*`,
                  ``,
                  `@${targetId} spotted your crew and tipped off police.`,
                  `💸 Fee lost: ${fmtMoney(COST)}`,
                  `⚠️ Your crime heat spiked +45`,
                  ``,
                  `Watch your back.`
              ].join('\n'),
              mentions: [toJid(targetId)]
          }, { quoted: mek });
      }
  } catch(e) { console.error('hitman error', e); }
});

// =============================================================================
// LOAN SHARK — Borrow money at 30% interest. Unpaid loans auto-deduct on login.
// =============================================================================
// LOAN SHARK — Borrow money. Interest compounds every 5 minutes.
// After 30 min unpaid the shark starts taking from your wallet automatically.
// loan take <amount> | loan pay <amount> | loan status
// =============================================================================
cmd({ pattern: "loan", desc: "loan take <amount> | loan pay <amount> | loan status", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id  = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);
      const sub = (args[0] || 'status').toLowerCase();
      const MAX_LOAN           = iC(500000);
      const RATE_PER_5MIN      = 0.02;   // 2% compound every 5 minutes = ~24% per hour
      const COMPOUND_INTERVAL  = 5 * 60 * 1000;

      // ── Apply compound interest on every getAccount call ─────────────────
      // (also done in getAccount loop, but we recalc here for display accuracy)
      function applyCompound(loan) {
          if (!loan || loan.owed <= 0) return loan;
          const intervals = Math.floor((Date.now() - (loan.lastCompound || loan.takenAt)) / COMPOUND_INTERVAL);
          if (intervals <= 0) return loan;
          let owed = loan.owed;
          for (let i = 0; i < intervals; i++) owed = Math.ceil(owed * (1 + RATE_PER_5MIN));
          loan.owed = owed;
          loan.lastCompound = (loan.lastCompound || loan.takenAt) + intervals * COMPOUND_INTERVAL;
          return loan;
      }

      const loan = acc.activeLoan ? applyCompound({ ...acc.activeLoan }) : null;

      if (sub === 'status') {
          if (!loan || loan.owed <= 0) return reply([
              `🦈 *LOAN SHARK*`,
              ``,
              `No outstanding debt. Good.`,
              ``,
              `Borrow up to ${fmtMoney(MAX_LOAN)}`,
              `⚠️ Interest: *4% every 5 minutes* (compounding)`,
              `⚠️ After 2 hours: shark auto-deducts from your wallet + bank`,
              `Usage: *loan take <amount>*`
          ].join('\n'));

          const age           = now() - loan.takenAt;
          const nextCompound  = COMPOUND_INTERVAL - ((Date.now() - (loan.lastCompound || loan.takenAt)) % COMPOUND_INTERVAL);
          const growthPct     = ((loan.owed / loan.principal - 1) * 100).toFixed(1);

          return reply([
              `🦈 *YOUR DEBT*`,
              ``,
              `📋 Original loan: ${fmtMoney(loan.principal)}`,
              `💀 Currently owed: *${fmtMoney(loan.owed)}* (+${growthPct}%)`,
              `⏱️ Taken: ${msToTime(age)} ago`,
              ``,
              `⚠️ Next interest tick in: *${msToTime(nextCompound)}*`,
              `📈 Rate: 2% per 5min (compounds — 2hr grace period before seizure)`,
              ``,
              `Pay now: *loan pay <amount>*`,
              `Pay all: *loan pay all*`
          ].join('\n'));
      }

      if (sub === 'take') {
          if (loan && loan.owed > 0) return reply(`🦈 Pay off your existing debt of *${fmtMoney(loan.owed)}* first.\nUse: *loan pay <amount>*`);
          if (isHospitalized(acc)) return reply(`🚨 Loan shark doesn't deal with inmates.`);
          const amount = parseInt(args[1]);
          if (!amount || amount <= 0) return reply(`Usage: loan take <amount>\nMax: ${fmtMoney(MAX_LOAN)}`);
          if (amount > MAX_LOAN) return reply(`Max loan is ${fmtMoney(MAX_LOAN)}.`);

          const initialOwed = Math.ceil(amount * 1.04); // first 5-min tick already baked in
          acc.money += amount;
          acc.activeLoan = {
              principal:    amount,
              owed:         initialOwed,
              takenAt:      now(),
              lastCompound: now(),
          };
          logFinancial(acc, `Loan from shark — owes ${fmtMoney(initialOwed)}`, amount);
          await saveAccount(acc);
          return reply([
              `🦈 *LOAN APPROVED*`,
              ``,
              `💵 Borrowed: *${fmtMoney(amount)}*`,
              `💀 Starting debt: *${fmtMoney(initialOwed)}*`,
              ``,
              `⚠️ *Interest: 4% every 5 minutes — it compounds.*`,
              `   In 30 min: ~${fmtMoney(Math.ceil(initialOwed * Math.pow(1.02, 6)))}`,
              `   In 1 hour: ~${fmtMoney(Math.ceil(initialOwed * Math.pow(1.02, 12)))}`,
              `   In 6 hours: ~${fmtMoney(Math.ceil(initialOwed * Math.pow(1.02, 72)))}`,
              `   In 24 hours: ~${fmtMoney(Math.ceil(initialOwed * Math.pow(1.02, 288)))}`,
              ``,
              `🦈 The shark will start taking your money after 2 hours.`,
              `Pay now: *loan pay all*`
          ].join('\n'));
      }

      if (sub === 'pay') {
          if (!loan || loan.owed <= 0) return reply(`You have no outstanding loan.`);
          const payAll = (args[1] || '').toLowerCase() === 'all';
          const amount = payAll ? Math.min(acc.money, loan.owed) : parseInt(args[1]);
          if (!amount || amount <= 0) return reply(`Usage: loan pay <amount> | loan pay all\nYou owe: ${fmtMoney(loan.owed)}`);
          const pay = Math.min(amount, loan.owed, acc.money);
          if (pay <= 0) return reply(`You don't have enough cash. You owe ${fmtMoney(loan.owed)}.`);

          acc.money -= pay;
          acc.moneySpent = (acc.moneySpent || 0) + pay;
          loan.owed -= pay;

          if (loan.owed <= 0) {
              acc.activeLoan = null;
              logFinancial(acc, `Loan fully repaid`, -pay);
              await saveAccount(acc);
              return reply(`🦈 *DEBT CLEARED!* Paid ${fmtMoney(pay)}. You're free. Don't come back.`);
          }

          // Save updated loan with compounded values
          acc.activeLoan = loan;
          logFinancial(acc, `Loan partial payment`, -pay);
          await saveAccount(acc);
          return reply(`🦈 Paid ${fmtMoney(pay)}. Remaining debt: *${fmtMoney(loan.owed)}* (still growing)`);
      }

      return reply(`Usage: loan status | loan take <amount> | loan pay <amount|all>`);
  } catch(e) { console.error('loan error', e); }
});

// =============================================================================
// PROTECT — Pay for temporary immunity from rob and gang rob attacks
// =============================================================================
cmd({ pattern: "protect", desc: "Buy temporary rob protection for 2 hours", category: "rpg", filename: __filename }, async (conn, mek, m, { reply }) => {
  try {
      const id  = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);

      if (isHospitalized(acc)) return reply(`🚨 You're in hospital/jail.`);
      if (isKidnapped(acc))    return reply(`🔒 You're kidnapped.`);

      const COST     = iC(15000);
      const DURATION = 2 * 60 * 60 * 1000; // 2 hours

      const existing = acc.robImmunityUntil || 0;
      if (existing > now()) {
          return reply([
              `🛡️ *Protection already active!*`,
              `Expires in: ${msToTime(existing - now())}`,
              ``,
              `You are immune to rob and gang rob until then.`
          ].join('\n'));
      }

      if (acc.money < COST) return reply(`💸 Protection costs *${fmtMoney(COST)}* for 2 hours. You have ${fmtMoney(acc.money)}.`);

      acc.money -= COST;
      acc.moneySpent = (acc.moneySpent || 0) + COST;
      acc.robImmunityUntil = now() + DURATION;
      logFinancial(acc, `Rob protection purchased (2h)`, -COST);
      await saveAccount(acc);

      return reply([
          `🛡️ *PROTECTION ACTIVE*`,
          ``,
          `Cost: ${fmtMoney(COST)}`,
          `Duration: 2 hours`,
          `Expires: ${new Date(acc.robImmunityUntil).toLocaleTimeString()}`,
          ``,
          `You are now immune to rob and gang rob attacks.`
      ].join('\n'));
  } catch(e) { console.error('protect error', e); }
});


// =============================================================================
// CARWASH — Launder dirty crime money. Converts crimeLevel heat into clean cash.
// The higher your heat, the bigger the laundry job — but it costs a 20% cut.
// =============================================================================
cmd({ pattern: "carwash", desc: "Launder dirty money (costs 20% cut)", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id  = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);
      if (isHospitalized(acc)) return reply(`🚨 You're locked up.`);
      if (isKidnapped(acc))    return reply(`🔒 You're kidnapped.`);

      const heat = acc.crimeLevel || 0;
      if (heat < 10) return reply([
          `🚗 *Weirdos World Car Wash*`,
          ``,
          `You need at least 10 crime heat to launder.`,
          `Your current heat: ${heat}/100`,
          ``,
          `Commit crimes to build up heat, then come back.`
      ].join('\n'));

      const COOLDOWN = 30 * 60 * 1000;
      const last = acc.cooldowns?.carwash || 0;
      if (now() - last < COOLDOWN) return reply(`⏳ The car wash needs ${msToTime(COOLDOWN - (now()-last))} to dry.`);

      const amount = parseInt(args[0]);
      if (!amount || amount <= 0) {
          const maxLaunder = Math.floor(acc.money * (heat / 100));
          return reply([
              `🚗 *WEIRDOS WORLD CAR WASH*`,
              `_We make your money sparkle clean._`,
              ``,
              `Your heat: 🔴 ${heat}/100`,
              `Max launderable (heat-based): *${fmtMoney(maxLaunder)}*`,
              `Cut: 20% goes to the house`,
              ``,
              `Usage: *carwash <amount>*`
          ].join('\n'));
      }

      const maxLaunder = Math.floor(acc.money * (heat / 100));
      if (amount > maxLaunder) return reply(`🚗 Too hot to launder that much. Max at current heat: ${fmtMoney(maxLaunder)}`);
      if (amount > acc.money)  return reply(`Not enough cash.`);

      const cut  = Math.ceil(amount * 0.20);
      const net  = amount - cut;
      const heatReduced = Math.floor(heat * (amount / Math.max(1, acc.money)) * 2);

      acc.money -= cut; // cut is gone — house takes it
      acc.crimeLevel = Math.max(0, heat - heatReduced);
      acc.cooldowns = acc.cooldowns || {};
      acc.cooldowns.carwash = now();
      logFinancial(acc, `Car wash laundry (-${fmtMoney(cut)} cut)`, -cut);
      await saveAccount(acc);

      return reply([
          `🚗 *LAUNDRY DONE*`,
          ``,
          `Amount laundered: ${fmtMoney(amount)}`,
          `House cut (20%): -${fmtMoney(cut)}`,
          `Net clean: *${fmtMoney(net)}*`,
          ``,
          `🌡️ Crime heat: ${heat} → *${acc.crimeLevel}* (-${heatReduced})`
      ].join('\n'));
  } catch(e) { console.error('carwash error', e); }
});

// =============================================================================
// PICKPOCKET @player — silent micro-rob, no weapon needed, 10 min cooldown
// Low risk, low reward. Can't fail into jail — just miss.
// =============================================================================
cmd({ pattern: "pickpocket", desc: "pickpocket @player — quietly lift their wallet", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id       = await getPlayerId(conn, m.sender);
      const targetId = await getTargetId(conn, mek, args, 0);
      if (!targetId)          return reply(`Usage: pickpocket @player`);
      if (targetId === id)    return reply(`You can't pickpocket yourself.`);

      const acc    = await getAccount(id);
      const victim = await getAccount(targetId);

      if (isHospitalized(acc)) return reply(`🚨 You're locked up.`);
      if (isKidnapped(acc))    return reply(`🔒 You're kidnapped.`);
      if (isInFlight(acc))     return reply(`✈️ You're in-flight.`);
      if (isInFlight(victim))  return reply(`✈️ Target is in-flight.`);

      const myCity = normLoc(acc.location);
      const vicCity = normLoc(victim.location);
      if (myCity !== vicCity) return reply(`🌍 You need to be in the same city as your target.`);

      const COOLDOWN = 10 * 60 * 1000;
      const last = acc.cooldowns?.pickpocket || 0;
      if (now() - last < COOLDOWN) return reply(`⏳ Keep your head down for another ${msToTime(COOLDOWN - (now()-last))}.`);

      if (!victim.money || victim.money < 100) return reply(`That player has nothing worth lifting.`);

      acc.cooldowns = acc.cooldowns || {};
      acc.cooldowns.pickpocket = now();
      acc.crimeLevel = Math.min(100, (acc.crimeLevel || 0) + 5);

      // Dexterity-based success
      const myDex  = (acc.dexterity || 3) + (getEconGearBonus(acc).dexBonus || 0);
      const vicSpd = (victim.speed || 3) + (getEconGearBonus(victim).spdBonus || 0);
      const chance = Math.min(0.80, Math.max(0.25, 0.45 + 0.03 * (myDex - vicSpd)));

      if (Math.random() < chance) {
          const stolen = Math.floor(Math.min(victim.money * 0.05, iC(5000)) * (0.5 + Math.random()));
          victim.money -= stolen;
          acc.money    += stolen;
          acc.crimesCommitted = (acc.crimesCommitted || 0) + 1;
          logFinancial(acc,    `Pickpocket vs @${targetId}`, stolen);
          logFinancial(victim, `Pickpocketed by @${id}`, -stolen);
          await saveAccount(acc);
          await saveAccount(victim);
          return reply(`🤚 *Dipped!* You lifted *${fmtMoney(stolen)}* from @${targetId}'s pocket without a sound.`);
      } else {
          await saveAccount(acc);
          return reply(`🤚 *Missed.* @${targetId} shifted just as you reached in. You pulled back clean — no jail, no fine.`);
      }
  } catch(e) { console.error('pickpocket error', e); }
});

// =============================================================================
// FENCE — Sell inventory items for quick cash (60% of blackmarket value)
// =============================================================================
cmd({ pattern: "fence", desc: "fence <item> [qty] — sell inventory to a fence", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id  = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);

      if (!args[0]) {
          const inv = acc.inventory || {};
          const keys = Object.keys(inv).filter(k => inv[k] > 0 && BLACKMARKET[k]);
          if (keys.length === 0) return reply([
              `🕵️ *BLACK MARKET FENCE*`,
              ``,
              `You have no sellable items.`,
              `Buy items from the blackmarket first.`
          ].join('\n'));

          let list = keys.map(k => {
              const val = Math.floor(BLACKMARKET[k].price * 0.60);
              return `• *${k}* x${inv[k]} — ${fmtMoney(val)} each`;
          }).join('\n');

          return reply([`🕵️ *FENCE PRICES (60% of market)*`, ``, list, ``, `Usage: fence <item> [qty]`].join('\n'));
      }

      const item = args[0].toLowerCase();
      const qty  = Math.max(1, parseInt(args[1]) || 1);

      if (!BLACKMARKET[item]) return reply(`❌ The fence doesn't deal in *${item}*.`);
      const have = acc.inventory?.[item] || 0;
      if (have < qty) return reply(`You only have ${have}x *${item}*.`);

      const priceEach = Math.floor(BLACKMARKET[item].price * 0.60);
      const total     = priceEach * qty;

      acc.inventory[item] -= qty;
      acc.money += total;
      logFinancial(acc, `Fenced ${qty}x ${item}`, total);
      await saveAccount(acc);

      return reply([
          `🕵️ *FENCED*`,
          ``,
          `${qty}x *${item}* → *${fmtMoney(total)}*`,
          `(${fmtMoney(priceEach)} each at 60% market rate)`,
          ``,
          `Cash: ${fmtMoney(acc.money)}`
      ].join('\n'));
  } catch(e) { console.error('fence error', e); }
});

// =============================================================================
// EXTORT @player — demand weekly protection money
// If they comply (auto-paid on their next login) you earn. If they fight back, war.
// =============================================================================
if (!global.extortions) global.extortions = {}; // { victimId: { extorterId, amount, expiresAt } }

cmd({ pattern: "extort", desc: "extort @player <amount> — demand protection money", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id       = await getPlayerId(conn, m.sender);
      const targetId = await getTargetId(conn, mek, args, 0);
      if (!targetId) return reply(`Usage: extort @player <amount>`);
      if (targetId === id) return reply(`You can't extort yourself.`);

      const amountArg = [...args].reverse().find(a => /^\d+$/.test(a));
      const amount    = parseInt(amountArg || '0');

      const acc    = await getAccount(id);
      const victim = await getAccount(targetId);

      if (isHospitalized(acc)) return reply(`🚨 You're locked up.`);
      if (isKidnapped(acc))    return reply(`🔒 You're kidnapped.`);

      if (!amount || amount < iC(500)) return reply(`Minimum extortion demand is ${fmtMoney(iC(500))}.\nUsage: extort @player <amount>`);
      if (amount > iC(100000)) return reply(`Max demand is ${fmtMoney(iC(100000))}. Don't be greedy.`);

      const myCity  = normLoc(acc.location);
      const vicCity = normLoc(victim.location);
      if (myCity !== vicCity) return reply(`🌍 You need to be in the same city to extort someone.`);

      if (!acc.equippedWeapon) return reply(`🔫 You need a weapon equipped to make a credible threat.`);

      const existing = global.extortions[targetId];
      if (existing && existing.expiresAt > now()) {
          return reply(`@${targetId} is already being extorted by someone else. Back off.`);
      }

      const COOLDOWN = 2 * 60 * 60 * 1000;
      const last = acc.cooldowns?.extort || 0;
      if (now() - last < COOLDOWN) return reply(`⏳ Lay low for ${msToTime(COOLDOWN - (now()-last))} before extorting again.`);

      acc.cooldowns = acc.cooldowns || {};
      acc.cooldowns.extort = now();
      acc.crimeLevel = Math.min(100, (acc.crimeLevel || 0) + 15);

      // Does the target resist?
      const myPower  = (acc.strength || 3) + (acc.level || 1) * 2 + (getEconGearBonus(acc).atkBonus || 0);
      const vicPower = (victim.strength || 3) + (victim.level || 1) * 2 + (getEconGearBonus(victim).defBonus || 0);
      const intimidate = Math.min(0.80, Math.max(0.20, 0.45 + 0.3 * (myPower - vicPower) / Math.max(vicPower, 1)));

      if (Math.random() < intimidate) {
          // Victim backs down — extortion set, auto-collected next login
          global.extortions[targetId] = {
              extorterId: id,
              amount,
              expiresAt: now() + 24 * 60 * 60 * 1000 // 24h window
          };
          setTimeout(() => { delete global.extortions[targetId]; }, 24 * 60 * 60 * 1000);

          await saveAccount(acc);
          return conn.sendMessage(m.chat, {
              text: [
                  `😤 *EXTORTION DEMAND SENT*`,
                  ``,
                  `You cornered @${targetId} and made your demand clear.`,
                  `💰 They owe you: *${fmtMoney(amount)}*`,
                  ``,
                  `It will be auto-collected next time they use any command.`,
                  `⚠️ Heat +15`
              ].join('\n'),
              mentions: [toJid(targetId)]
          }, { quoted: mek });
      } else {
          // Target fights back — both take damage, extorter gets hurt worse
          const dmg = Math.floor(15 + Math.random() * 20);
          acc.health = Math.max(0, (acc.health || 100) - dmg);
          if (acc.health <= 0) acc.jailedUntil = now() + 10 * 60 * 1000;
          await saveAccount(acc);
          return conn.sendMessage(m.chat, {
              text: [
                  `💥 *EXTORTION BACKFIRED!*`,
                  ``,
                  `@${targetId} pulled a weapon and fought back!`,
                  `❤️ You took ${dmg} damage. HP: ${acc.health}`,
                  acc.health <= 0 ? `🚑 You were knocked out — hospitalised 10 min.` : ``,
                  ``,
                  `Maybe pick a softer target.`
              ].filter(Boolean).join('\n'),
              mentions: [toJid(targetId)]
          }, { quoted: mek });
      }
  } catch(e) { console.error('extort error', e); }
});

// Hook extortion auto-collection into getAccount (applied at top of function)
// NOTE: This is handled inline — on every getAccount call, we check extortions.
// We patch saveAccount to run this check. Actually we inject into getAccount via a post-hook below.
// The cleaner way: check in getAccount after loading. We do it by patching extortion check into the return path.

// =============================================================================
// COUNTDOWN — See ALL your active cooldowns and timers in one place
// =============================================================================
async function handleCountdownCmd(conn, mek, m, { reply }) {
  try {
      const id  = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);
      const cd  = acc.cooldowns || {};
      const nowTs = now();

      const lines = [];

      if (acc.jailedUntil > nowTs)
          lines.push(`⛓️ Jail/Hospital: *${msToTime(acc.jailedUntil - nowTs)}* left`);
      if (acc.travelingUntil > nowTs)
          lines.push(`✈️ Flight to *${acc.travelingTo}*: *${msToTime(acc.travelingUntil - nowTs)}* left`);
      if (acc.kidnappedBy)
          lines.push(`🔒 Kidnapped by @${acc.kidnappedBy}${acc.ransomAmount > 0 ? ` — Ransom: ${fmtMoney(acc.ransomAmount)}` : ''}`);
      if (acc.robImmunityUntil > nowTs)
          lines.push(`🛡️ Rob protection: *${msToTime(acc.robImmunityUntil - nowTs)}* left`);
      if (acc.gearInsurance && acc.gearInsuranceExpiresAt > nowTs)
          lines.push(`🛡️ Gear insurance: *${msToTime(acc.gearInsuranceExpiresAt - nowTs)}* left`);
      if (acc.activeLoan?.owed > 0)
          lines.push(`🦈 Loan debt: *${fmtMoney(acc.activeLoan.owed)}* outstanding`);

      const COOLDOWNS = {
          shift:      ['👔 Shift',       30*60*1000],
          wager:      ['🎲 Wager',        5*60*1000],
          pickpocket: ['🤚 Pickpocket',  10*60*1000],
          smuggle:    ['🧳 Smuggle',     45*60*1000],
          hitman:     ['🔫 Hitman',      60*60*1000],
          carwash:    ['🚗 Car Wash',    30*60*1000],
          extort:     ['😤 Extort',     120*60*1000],
          duel:       ['⚔️ Duel',         5*60*1000],
      };

      for (const [key, [label, cdMs]] of Object.entries(COOLDOWNS)) {
          const last = cd[key] || 0;
          const remaining = cdMs - (nowTs - last);
          if (remaining > 0) lines.push(`${label}: *${msToTime(remaining)}* left`);
      }

      // Check torn.js cooldowns from shared player doc
      const tornCooldowns = [
          ['⚔️ Attack',       acc.lastAttack  || 0,  3*60*1000],
          ['🔪 Crime',        acc.lastCrime   || 0,  0], // varies by crime
          ['🏦 Bank Rob',     acc.lastBankRob || 0, 60*60*1000],
          ['🎯 Hunt',         acc.lastHunt    || 0, 15*60*1000],
          ['🔍 Search',       acc.lastSearch  || 0, 30*60*1000],
          ['🤲 Beg',          acc.lastBeg     || 0, 15*60*1000],
          ['📅 Daily',        acc.lastDaily   || 0, 24*60*60*1000],
          ['👊 Kidnap',       acc.lastKidnap  || 0,  4*60*60*1000],
      ];
      for (const [label, last, cdMs] of tornCooldowns) {
          if (!last || !cdMs) continue;
          const remaining = cdMs - (nowTs - last);
          if (remaining > 0) lines.push(`${label}: *${msToTime(remaining)}* left`);
      }

      if (lines.length === 0) return reply(`✅ *All clear!* You have no active timers or cooldowns. Go cause trouble.`);

      return reply([`⏳ *YOUR ACTIVE TIMERS*`, ``, ...lines].join('\n'));
  } catch(e) { console.error('countdown error', e); }
}
cmd({ pattern: 'countdown', desc: 'See all your active cooldowns',  category: 'rpg', filename: __filename }, handleCountdownCmd);
cmd({ pattern: 'timers',    desc: 'See cooldowns (alias: countdown)', category: 'rpg', filename: __filename }, handleCountdownCmd);

// =============================================================================
// AIRDROP — Creator drops cash to every player in a specific city
// =============================================================================
cmd({ pattern: "airdrop", desc: "[Creator] airdrop <city> <amount> — drop cash to all players in a city", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id = await getPlayerId(conn, m.sender);
      if (id !== '2348084644182') return reply(`❌ Creator-only command.`);

      const city   = (args[0] || '').toLowerCase();
      const amount = parseInt(args[1]);

      const validCities = ['weirdosworld', 'mexico', 'london', 'japan', 'switzerland', 'all'];
      if (!city || !validCities.includes(city.replace(/\s/g,''))) {
          return reply([
              `Usage: airdrop <city> <amount>`,
              `Cities: weirdosworld | mexico | london | japan | switzerland | all`,
              `Example: airdrop all 50000`
          ].join('\n'));
      }
      if (!amount || amount <= 0) return reply(`Usage: airdrop <city> <amount>`);

      const db = await connectDB();
      let query = {};
      if (city !== 'all') {
          // normalise city name for DB match
          const cityMap = { weirdosworld: 'Weirdos World', mexico: 'Mexico', london: 'London', japan: 'Japan', switzerland: 'Switzerland' };
          query = { location: cityMap[city] || city };
      }
      const players = await db.collection('rpgplayers').find(query).toArray();
      if (!players.length) return reply(`No players found in ${city}.`);

      const mentions = [];
      for (const p of players) {
          p.money = (p.money || 0) + amount;
          await db.collection('rpgplayers').updateOne({ _id: p._id }, { $inc: { money: amount } });
          mentions.push(toJid(p._id));
      }

      const cityLabel = city === 'all' ? 'ALL cities' : city.charAt(0).toUpperCase() + city.slice(1);
      return conn.sendMessage(m.chat, {
          text: [
              `🪂 *AIRDROP!*`,
              ``,
              `💰 *${fmtMoney(amount)}* dropped to *${players.length} players* in *${cityLabel}*!`,
              ``,
              players.slice(0,10).map(p => `• ${p.username || p._id}`).join('\n'),
              players.length > 10 ? `...and ${players.length - 10} more` : ''
          ].filter(Boolean).join('\n'),
          mentions
      }, { quoted: mek });
  } catch(e) { console.error('airdrop error', e); }
});

// =============================================================================
// DUEL @player <amount> — Direct PvP cash wager. Both lock in, stats decide.
// =============================================================================
if (!global.duelChallenges) global.duelChallenges = {}; // { challengedId: { challengerId, amount, expiresAt } }

cmd({ pattern: "duel", desc: "duel @player <amount> — challenge to a cash duel | duel accept", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id  = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);
      const sub = (args[0] || '').toLowerCase();

      if (isHospitalized(acc)) return reply(`🚨 You're locked up.`);
      if (isKidnapped(acc))    return reply(`🔒 You're kidnapped.`);

      // ── ACCEPT ────────────────────────────────────────────────────────────
      if (sub === 'accept') {
          const challenge = global.duelChallenges[id];
          if (!challenge) return reply(`You have no pending duel challenge. Someone needs to challenge you first.`);
          if (challenge.expiresAt < now()) {
              delete global.duelChallenges[id];
              return reply(`That duel challenge expired.`);
          }

          const challengerId = challenge.challengerId;
          const amount       = challenge.amount;
          const challenger   = await getAccount(challengerId);

          if (challenger.money < amount) {
              delete global.duelChallenges[id];
              return reply(`@${challengerId} no longer has enough money to cover the duel.`);
          }
          if (acc.money < amount) return reply(`You need ${fmtMoney(amount)} in your wallet to accept.`);

          delete global.duelChallenges[id];

          // Stat-based outcome — attack + speed + gear vs opponent
          const myGear  = getEconGearBonus(acc);
          const theirGear = getEconGearBonus(challenger);
          const myPower = (acc.strength || 3) + (acc.speed || 3) + (acc.dexterity || 3) + myGear.atkBonus + myGear.spdBonus + Math.random() * 30;
          const thPower = (challenger.strength || 3) + (challenger.speed || 3) + (challenger.dexterity || 3) + theirGear.atkBonus + theirGear.spdBonus + Math.random() * 30;

          const myWin = myPower > thPower;
          const winnerId = myWin ? id : challengerId;
          const loserId  = myWin ? challengerId : id;
          const winner   = myWin ? acc : challenger;
          const loser    = myWin ? challenger : acc;

          winner.money += amount;
          addTaxableIncome(winner, amount);
          loser.money  -= amount;
          winner.cooldowns = winner.cooldowns || {}; winner.cooldowns.duel = now();
          loser.cooldowns  = loser.cooldowns  || {}; loser.cooldowns.duel  = now();

          logFinancial(winner, `Duel win vs @${loserId}`, amount);
          logFinancial(loser,  `Duel loss vs @${winnerId}`, -amount);
          await saveAccount(winner);
          await saveAccount(loser);

          return conn.sendMessage(m.chat, {
              text: [
                  `⚔️ *DUEL RESULT*`,
                  ``,
                  `@${id} vs @${challengerId}`,
                  `💰 Pot: ${fmtMoney(amount * 2)} | Winner takes all`,
                  ``,
                  `🏆 *WINNER: @${winnerId}* (+${fmtMoney(amount)})`,
                  `💀 *LOSER: @${loserId}* (-${fmtMoney(amount)})`,
              ].join('\n'),
              mentions: [toJid(id), toJid(challengerId)]
          }, { quoted: mek });
      }

      // ── CHALLENGE ─────────────────────────────────────────────────────────
      const targetId = await getTargetId(conn, mek, args, 0);
      if (!targetId) return reply([
          `⚔️ *DUEL SYSTEM*`,
          ``,
          `Challenge: *duel @player <amount>*`,
          `Accept:    *duel accept*`,
          ``,
          `Stats decide the winner. No pure luck.`,
          `Both players must have the amount in wallet.`
      ].join('\n'));

      if (targetId === id) return reply(`You can't duel yourself.`);

      const amountArg = [...args].reverse().find(a => /^\d+$/.test(a));
      const amount    = parseInt(amountArg || '0');
      if (!amount || amount < iC(500)) return reply(`Minimum duel wager is ${fmtMoney(iC(500))}.`);
      if (acc.money < amount) return reply(`You need *${fmtMoney(amount)}* in your wallet to put up as stake.`);

      const COOLDOWN = 5 * 60 * 1000;
      const last = acc.cooldowns?.duel || 0;
      if (now() - last < COOLDOWN) return reply(`⏳ Cooldown: ${msToTime(COOLDOWN - (now()-last))} before challenging again.`);

      const myCity  = normLoc(acc.location);
      const target  = await getAccount(targetId);
      const vicCity = normLoc(target.location);
      if (myCity !== vicCity) return reply(`🌍 You need to be in the same city to duel.`);

      // Expire any old challenge to this player
      if (global.duelChallenges[targetId]) delete global.duelChallenges[targetId];

      global.duelChallenges[targetId] = { challengerId: id, amount, expiresAt: now() + 5 * 60 * 1000 };
      setTimeout(() => { delete global.duelChallenges[targetId]; }, 5 * 60 * 1000);

      return conn.sendMessage(m.chat, {
          text: [
              `⚔️ *DUEL CHALLENGE!*`,
              ``,
              `@${id} challenges @${targetId} to a duel!`,
              `💰 Stake: *${fmtMoney(amount)}* each — winner takes *${fmtMoney(amount * 2)}*`,
              ``,
              `@${targetId}: run *duel accept* within 5 minutes.`,
              `_Stats decide the outcome — no pure luck._`
          ].join('\n'),
          mentions: [toJid(id), toJid(targetId)]
      }, { quoted: mek });

  } catch(e) { console.error('duel error', e); }
});

// =============================================================================
// TAXIRIDE — Pay to instantly move to any city without the flight timer
// Costs significantly more than flying but skips the wait entirely
// =============================================================================
cmd({ pattern: "taxi", desc: "taxi <city> — instant travel, no flight timer (expensive)", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id  = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);

      if (isHospitalized(acc)) return reply(`🚨 You're in jail/hospital.`);
      if (isKidnapped(acc))    return reply(`🔒 You're kidnapped.`);
      if (isInFlight(acc))     return reply(`✈️ You're already in-flight. Can't taxi mid-air.`);

      const TAXI_PRICES = {
          'weirdos world': 0,
          mexico:         iC(25000),
          london:         iC(60000),
          japan:          iC(100000),
          switzerland:    iC(175000),
          dubai:          iC(225000),
          'new york':     iC(90000),
          paris:          iC(75000),
          lagos:          iC(40000),
          moscow:         iC(125000),
          sydney:         iC(150000),
          'rio de janeiro': iC(110000),
      };
      const CITY_NAMES = {
          'weirdos world':  'Weirdos World',
          mexico:           'Mexico',
          london:           'London',
          japan:            'Japan',
          switzerland:      'Switzerland',
          dubai:            'Dubai',
          'new york':       'New York',
          paris:            'Paris',
          lagos:            'Lagos',
          moscow:           'Moscow',
          sydney:           'Sydney',
          'rio de janeiro': 'Rio de Janeiro',
      };

      const TAXI_ALIAS = {
          ww: 'weirdos world', torn: 'weirdos world', torncity: 'weirdos world',
          weirdosworld: 'weirdos world', weirdos: 'weirdos world', home: 'weirdos world',
          mex: 'mexico', mexico: 'mexico',
          london: 'london', uk: 'london', england: 'london',
          jp: 'japan', japan: 'japan', tokyo: 'japan',
          swiss: 'switzerland', switzerland: 'switzerland', zurich: 'switzerland', switz: 'switzerland',
          uae: 'dubai', dubai: 'dubai',
          ny: 'new york', nyc: 'new york', newyork: 'new york',
          fr: 'paris', france: 'paris', paris: 'paris',
          ng: 'lagos', nigeria: 'lagos', lagos: 'lagos',
          ru: 'moscow', russia: 'moscow', moscow: 'moscow',
          au: 'sydney', australia: 'sydney', sydney: 'sydney',
          brazil: 'rio de janeiro', rio: 'rio de janeiro',
      };
      const dest = TAXI_ALIAS[(args[0] || '').toLowerCase().replace(/[\s_-]/g, '')] || (args[0] || '').toLowerCase();

      if (!dest || !TAXI_PRICES.hasOwnProperty(dest)) {
          const currentCity = (acc.location || 'Weirdos World');
          let list = Object.entries(TAXI_PRICES)
              .filter(([c]) => c !== currentCity.toLowerCase())
              .map(([c, p]) => `  ${CITY_NAMES[c]} — ${fmtMoney(p)}`)
              .join('\n');
          return reply([
              `🚕 *TAXI SERVICE*`,
              `_Instant travel. No flight timer._`,
              ``,
              `📍 You are in: *${currentCity}*`,
              ``,
              list,
              ``,
              `Usage: *taxi <city>*`,
              `e.g. taxi japan`
          ].join('\n'));
      }

      const currentCity = normLoc(acc.location).toLowerCase();
      if (dest === currentCity) return reply(`You're already in ${CITY_NAMES[dest] || dest}.`);

      // Weather block check
      const destProper = CITY_NAMES[dest] || dest;
      const weather    = global.cityWeather?.[destProper];
      const sevMap     = { '☀️ Clear':0,'🌤️ Partly Cloudy':0,'🌧️ Rain':1,'⛈️ Thunderstorm':2,'🌨️ Blizzard':3,'🌪️ Hurricane':4,'🌫️ Dense Fog':1 };
      const sev        = sevMap[weather] ?? 0;
      if (sev >= 3) return reply(`⛔ *${destProper}* is currently experiencing *${weather}*. Taxi service suspended — no driver will go there right now.`);

      const fare = TAXI_PRICES[dest];
      if (acc.money < fare) return reply(`🚕 Taxi to *${CITY_NAMES[dest]}* costs *${fmtMoney(fare)}*. You have ${fmtMoney(acc.money)}.`);

      acc.money -= fare;
      acc.moneySpent = (acc.moneySpent || 0) + fare;
      acc.location = CITY_NAMES[dest];
      // Ensure no in-flight state lingers
      acc.travelingTo    = null;
      acc.travelingUntil = 0;

      logFinancial(acc, `Taxi to ${CITY_NAMES[dest]}`, -fare);
      await saveAccount(acc);

      return reply([
          `🚕 *TAXI — ARRIVED!*`,
          ``,
          `Destination: *${CITY_NAMES[dest]}*`,
          `Fare paid: *${fmtMoney(fare)}*`,
          ``,
          `You stepped out of the cab. Welcome to ${CITY_NAMES[dest]}.`
      ].join('\n'));
  } catch(e) { console.error('taxi error', e); }
});


// =============================================================================
// GIFT — Send items from your inventory to another player
// gift @player <item> [qty] | gear slot | property
// =============================================================================
cmd({ pattern: "gift", desc: "gift @player <item|weapon|property> — send items, gear, or properties", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id       = await getPlayerId(conn, m.sender);
      const targetId = await getTargetId(conn, mek, args, 0);
      if (!targetId) return reply([
          `🎁 *GIFT SYSTEM*`, ``,
          `Inventory item:  gift @player <item> [qty]`,
          `Equipped gear:   gift @player weapon|armor|helmet|gloves|kneepads|boots`,
          `Property:        gift @player property <propId> [qty]`,
          ``, `Examples:`,
          `  gift @max medkit 5`,
          `  gift @max weapon`,
          `  gift @max property shack 2`
      ].join('\n'));
      if (targetId === id) return reply(`You can't gift to yourself.`);

      const cleanArgs = args.filter(a => !a.includes('@'));
      const itemName  = (cleanArgs[0] || '').toLowerCase();
      const qty       = Math.max(1, parseInt([...cleanArgs].reverse().find(a => /^\d+$/.test(a)) || '1'));
      if (!itemName) return reply(`Usage: gift @player <item> [qty]`);

      const acc    = await getAccount(id);
      const target = await getAccount(targetId);
      if (isHospitalized(acc)) return reply(`🚨 Can't gift from jail/hospital.`);
      if (isKidnapped(acc))    return reply(`🔒 You're kidnapped.`);

      const GEAR_SLOTS = { weapon:'equippedWeapon', armor:'equippedArmor', helmet:'equippedHelmet', gloves:'equippedGloves', kneepads:'equippedKneePads', boots:'equippedBoots' };

      // ── EQUIPPED GEAR GIFT ──────────────────────────────────────────────────
      if (GEAR_SLOTS[itemName]) {
          const slotField = GEAR_SLOTS[itemName];
          const gearId    = acc[slotField];
          if (!gearId) return reply(`❌ Nothing equipped in the *${itemName}* slot.`);
          acc[slotField] = null;
          target.inventory = target.inventory || {};
          target.inventory[gearId] = (target.inventory[gearId] || 0) + 1;
          await saveAccount(acc); await saveAccount(target);
          return conn.sendMessage(m.chat, {
              text: [`🎁 *GEAR GIFTED!*`, ``, `@${id} handed their *${gearId}* to @${targetId}`, `📦 It's in @${targetId}'s stash — equip with: use ${gearId}`].join('\n'),
              mentions: [toJid(id), toJid(targetId)]
          }, { quoted: mek });
      }

      // ── PROPERTY GIFT ───────────────────────────────────────────────────────
      if (itemName === 'property') {
          const propId  = (cleanArgs[1] || '').toLowerCase();
          const propQty = Math.max(1, parseInt(cleanArgs[2]) || 1);
          if (!propId) return reply(`Usage: gift @player property <propId> [qty]`);
          const have = acc.properties?.[propId] || 0;
          if (have < propQty) return reply(`❌ You only own ${have}x *${propId}*.`);
          acc.properties[propId] = have - propQty;
          if (acc.properties[propId] === 0) delete acc.properties[propId];
          target.properties = target.properties || {};
          target.properties[propId] = (target.properties[propId] || 0) + propQty;
          await saveAccount(acc); await saveAccount(target);
          return conn.sendMessage(m.chat, {
              text: [`🏠 *PROPERTY GIFTED!*`, ``, `@${id} transferred *${propQty}x ${propId}* to @${targetId}`, `Remaining with you: ${acc.properties[propId] || 0}x ${propId}`].join('\n'),
              mentions: [toJid(id), toJid(targetId)]
          }, { quoted: mek });
      }

      // ── INVENTORY ITEM GIFT ─────────────────────────────────────────────────
      const have = acc.inventory?.[itemName] || 0;
      if (have <= 0) {
          const isEquipped = Object.values(GEAR_SLOTS).some(s => acc[s] === itemName);
          return reply(`❌ You don't have *${itemName}* in your stash.${isEquipped ? '\n💡 It\'s equipped — use: gift @player weapon (or armor/helmet/etc.)' : ''}`);
      }
      if (have < qty) return reply(`❌ You only have ${have}x *${itemName}*.`);
      acc.inventory[itemName] = have - qty;
      target.inventory = target.inventory || {};
      target.inventory[itemName] = (target.inventory[itemName] || 0) + qty;
      await saveAccount(acc); await saveAccount(target);
      return conn.sendMessage(m.chat, {
          text: [`🎁 *GIFT SENT!*`, ``, `@${id} gifted *${qty}x ${itemName}* to @${targetId}`, `📦 Your remaining: ${acc.inventory[itemName]}x ${itemName}`].join('\n'),
          mentions: [toJid(id), toJid(targetId)]
      }, { quoted: mek });
  } catch(e) { console.error('gift error', e); }
})
// =============================================================================
// ROBLOX-INSPIRED FEATURES
// =============================================================================

// ── PET SYSTEM ───────────────────────────────────────────────────────────────
// Adopt pets that give passive stat bonuses. Feed them or they run away.
// pet adopt <name> | pet feed | pet status | pet release
const PETS = {
    dog:     { name: 'Dog',     price: iC(25000),      power: 18,  bonus: { strBonus: 5,  spdBonus: 3  }, icon: '🐶', desc: '+5 Str, +3 Spd. Bites attackers for 18 dmg.' },
    cat:     { name: 'Cat',     price: iC(15000),       power: 14,  bonus: { dexBonus: 8,  spdBonus: 5  }, icon: '🐱', desc: '+8 Dex, +5 Spd. Scratches for 14 dmg.' },
    parrot:  { name: 'Parrot',  price: iC(80000),       power: 20,  bonus: { dexBonus: 12, strBonus: 3  }, icon: '🦜', desc: '+12 Dex, +3 Str. Dive-bombs for 20 dmg.' },
    penguin: { name: 'Penguin', price: iC(50000),       power: 22,  bonus: { defBonus: 10, spdBonus: 6  }, icon: '🐧', desc: '+10 Def, +6 Spd. Body-slams for 22 dmg.' },
    wolf:    { name: 'Wolf',    price: iC(500000),      power: 55,  bonus: { strBonus: 18, spdBonus: 12 }, icon: '🐺', desc: '+18 Str, +12 Spd. Goes for the throat: 55 dmg.' },
    bear:    { name: 'Bear',    price: iC(1500000),     power: 80,  bonus: { strBonus: 25, defBonus: 15 }, icon: '🐻', desc: '+25 Str, +15 Def. Mauls enemies for 80 dmg.' },
    shark:   { name: 'Shark',   price: iC(10000000),    power: 120, bonus: { strBonus: 40, dexBonus: 20 }, icon: '🦈', desc: '+40 Str, +20 Dex. Shreds for 120 dmg.' },
    dragon:  { name: 'Dragon',  price: iC(50000000),    power: 200, bonus: { strBonus: 60, defBonus: 40, spdBonus: 20 }, icon: '🐉', desc: '+60 Str, +40 Def, +20 Spd. Breathes fire: 200 dmg.' },
};

cmd({ pattern: "pet", desc: "pet adopt <type> | pet feed | pet status | pet list", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id  = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);
      const sub = (args[0] || 'status').toLowerCase();

      if (sub === 'list') {
          let out = `🐾 *AVAILABLE PETS*\n_Your pet fights alongside you in every battle._\n\n`;
          for (const [key, p] of Object.entries(PETS)) {
              out += `${p.icon} *${p.name}* — pet adopt ${key}\n   ⚔️ Combat Power: ${p.power} | 💰 ${fmtMoney(p.price)}\n   ${p.desc}\n\n`;
          }
          return reply(out);
      }

      if (sub === 'status') {
          if (!acc.pet?.type) return reply(`🐾 You have no pet.\nAdopt one with: *pet adopt <type>*\nSee options: *pet list*`);
          const p        = PETS[acc.pet.type];
          const petLvl   = acc.pet.level || 1;
          const petXp    = acc.pet.xp    || 0;
          const xpNeeded = petXpToLevel(petLvl);
          const curPower = petLevelPower(p?.power || 0, petLvl);
          const hungry   = (now() - (acc.pet.lastFed || 0)) > 12 * 60 * 60 * 1000;
          const starving = (now() - (acc.pet.lastFed || 0)) > 24 * 60 * 60 * 1000;
          const mood     = starving ? '💀 Starving — won\'t fight!' : hungry ? '😢 Hungry — feed me!' : '😊 Happy & ready to fight';
          const nickname = acc.pet.nickname;
          const xpBar    = (() => {
              const filled = Math.floor((petXp / xpNeeded) * 10);
              return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${petXp}/${xpNeeded}`;
          })();
          return reply([
              `${p?.icon || '🐾'} *${nickname ? `${nickname} the ${acc.pet.type}` : acc.pet.type.toUpperCase()} — Level ${petLvl}*`,
              nickname ? `_"${nickname}"_ 🏷️` : `Tip: name your pet with *pet name <n>*`,
              ``,
              `Mood: ${mood}`,
              `Last fed: ${acc.pet.lastFed ? msToTime(now() - acc.pet.lastFed) + ' ago' : 'Never!'}`,
              ``,
              `⚔️ Combat Power: *${curPower} dmg/round*`,
              `📊 Stats: ${Object.entries(petLevelBonus(p?.bonus || {}, petLvl)).map(([k,v]) => `+${v} ${k.replace('Bonus','')}`).join(', ')}`,
              ``,
              `📈 XP: ${xpBar}`,
              petLvl > 1 ? `🔺 Power: base ${p?.power} → *${curPower}* at Lv${petLvl}` : `Train: *pettrain attack | defense | speed*`,
              ``,
              hungry ? `⚠️ Feed: *pet feed*` : `Next training: *pettrain attack | defense | speed*`
          ].join('\n'));
      }

      if (sub === 'feed') {
          if (!acc.pet?.type) return reply(`You don't have a pet to feed.`);
          const FEED_COST = iC(500);
          if (acc.money < FEED_COST) return reply(`Feeding your pet costs ${fmtMoney(FEED_COST)}.`);
          acc.money -= FEED_COST;
          acc.pet.lastFed = now();
          await saveAccount(acc);
          const p = PETS[acc.pet.type];
          return reply(`${p?.icon || '🐾'} You fed your *${acc.pet.type}* for ${fmtMoney(FEED_COST)}. It's happy and well-fed!`);
      }

      if (sub === 'release') {
          if (!acc.pet?.type) return reply(`You don't have a pet.`);
          const displayName = acc.pet.nickname || acc.pet.type;
          acc.pet = null;
          await saveAccount(acc);
          return reply(`🐾 You released *${displayName}* into the wild. Goodbye!`);
      }

      if (sub === 'name') {
          if (!acc.pet?.type) return reply(`You don't have a pet to name.`);
          const newName = args.slice(1).join(' ').trim();
          if (!newName) return reply(`Usage: pet name <name>\nExample: pet name Max`);
          if (newName.length > 20) return reply(`Pet name too long. Max 20 characters.`);
          if (!/^[a-zA-Z0-9 _'\-]+$/.test(newName)) return reply(`Pet name can only contain letters, numbers, spaces, and basic punctuation.`);
          const oldName = acc.pet.nickname || acc.pet.type;
          acc.pet.nickname = newName;
          await saveAccount(acc);
          const p = PETS[acc.pet.type];
          return reply(`${p?.icon || '🐾'} Your ${acc.pet.type} has been named *${newName}*! They seem happy about it.`);
      }

      if (sub === 'adopt') {
          if (acc.pet?.type) return reply(`You already have *${acc.pet.nickname || acc.pet.type}*. Release it first with: *pet release*`);
          const type = (args[1] || '').toLowerCase();
          const petDef = PETS[type];
          if (!petDef) return reply(`Unknown pet type. See *pet list* for options.`);
          if (acc.money < petDef.price) return reply(`${petDef.icon} *${petDef.name}* costs ${fmtMoney(petDef.price)}. You have ${fmtMoney(acc.money)}.`);
          acc.money -= petDef.price;
          acc.moneySpent = (acc.moneySpent || 0) + petDef.price;
          const nickname = args.slice(2).join(' ').trim() || null;
          acc.pet = {
              type:        type,
              nickname:    nickname,
              level:       1,
              xp:          0,
              adoptedAt:   now(),
              lastFed:     now(),
              lastTrained: 0,
              injured:     false,
          };
          logFinancial(acc, `Adopted pet: ${type}${nickname ? ` (${nickname})` : ''}`, -petDef.price);
          await saveAccount(acc);
          return reply([
              `${petDef.icon} *PET ADOPTED!*`,
              ``,
              `You adopted a *${petDef.name}*!`,
              nickname ? `Name: *${nickname}*` : `Tip: give it a name with *pet name <name>*`,
              `Cost: ${fmtMoney(petDef.price)}`,
              ``,
              `${petDef.desc}`,
              ``,
              `Feed every 12h or it runs away. Train with: *pettrain attack*`
          ].filter(Boolean).join('\n'));
      }

      return reply(`Usage: pet list | pet adopt <type> [name] | pet name <name> | pet feed | pet status | pet release`);
  } catch(e) { console.error('pet error', e); }
});

// =============================================================================
// PET LEVELLING HELPERS
// =============================================================================
// XP needed to reach next pet level — grows each level
function petXpToLevel(level) { return 100 + (level - 1) * 80; }

// Total combat power for a pet factoring in its current level
// Base power scales × (1 + 0.12 per level above 1) — level 10 pet = 2.08× base
function petLevelPower(basePower, petLevel) {
    return Math.floor(basePower * (1 + (petLevel - 1) * 0.12));
}

// Stat bonuses also scale with pet level (+5% per level above 1)
function petLevelBonus(baseBonus, petLevel) {
    const mult = 1 + (petLevel - 1) * 0.05;
    const result = {};
    for (const [k, v] of Object.entries(baseBonus)) result[k] = Math.floor(v * mult);
    return result;
}

function getPetBonus(acc) {
    if (!acc.pet?.type) return {};
    const p = PETS[acc.pet.type];
    if (!p) return {};
    if ((now() - (acc.pet.lastFed || 0)) > 24 * 60 * 60 * 1000) return {};
    const lvl = acc.pet.level || 1;
    return petLevelBonus(p.bonus || {}, lvl);
}

// =============================================================================
// PET TRAINING — pet train [focus]
// focus: attack | defense | speed  (default: attack)
// 20-min cooldown per training session
// =============================================================================
async function handlePetTrainCmd(conn, mek, m, { args, reply }) {
    try {
        const id  = await getPlayerId(conn, m.sender);
        const acc = await getAccount(id);

        if (!acc.pet?.type) return reply(`🐾 You don't have a pet to train.\nAdopt one with: *pet adopt <type>*`);

        const p       = PETS[acc.pet.type];
        const petLvl  = acc.pet.level || 1;
        const petXp   = acc.pet.xp    || 0;
        const xpNeeded = petXpToLevel(petLvl);
        const petName  = acc.pet.nickname || p.name;

        // Hungry pet can't train
        if ((now() - (acc.pet.lastFed || 0)) > 12 * 60 * 60 * 1000)
            return reply(`${p.icon} *${petName}* is too hungry to train. Feed it first: *pet feed*`);

        const COOLDOWN   = 20 * 60 * 1000;
        const TRAIN_COST = iC(2000);
        const last       = acc.pet.lastTrained || 0;
        if (now() - last < COOLDOWN)
            return reply(`⏳ Your pet is resting. Next session in ${msToTime(COOLDOWN - (now() - last))}.`);

        if (!args[0]) {
            const curPower = petLevelPower(p.power, petLvl);
            return reply([
                `${p.icon} *${petName.toUpperCase()} — TRAINING DOJO*`,
                ``,
                `Level: *${petLvl}* | XP: ${petXp}/${xpNeeded}`,
                `⚔️ Current Power: *${curPower}* dmg`,
                ``,
                `Training sessions cost ${fmtMoney(TRAIN_COST)} each.`,
                `Each session grants 15–35 XP. Level up = +12% combat power.`,
                ``,
                `*Focuses:*`,
                `• *pettrain attack*  — more XP, slight health risk`,
                `• *pettrain defense* — balanced XP, toughens up`,
                `• *pettrain speed*   — moderate XP, improves dodge`,
                ``,
                `Run: *pettrain attack* (or defense / speed)`
            ].join('\n'));
        }

        const focus = (args[0] || 'attack').toLowerCase();
        if (!['attack','defense','speed'].includes(focus))
            return reply(`Invalid focus. Choose: attack | defense | speed`);

        if (acc.money < TRAIN_COST)
            return reply(`Training costs ${fmtMoney(TRAIN_COST)}. You have ${fmtMoney(acc.money)}.`);

        acc.money -= TRAIN_COST;
        acc.moneySpent = (acc.moneySpent || 0) + TRAIN_COST;

        // XP gain varies by focus
        const XP_RANGES = { attack: [25, 40], defense: [20, 35], speed: [18, 32] };
        const [xpMin, xpMax] = XP_RANGES[focus];
        const gainedXp = xpMin + Math.floor(Math.random() * (xpMax - xpMin + 1));

        // Attack training has a small injury chance
        let injuryLine = '';
        if (focus === 'attack' && Math.random() < 0.15) {
            injuryLine = `\n⚠️ Pushed too hard — ${petName} is a little sore. Feed it to recover.`;
        }

        // Rebuild pet as a fresh plain object — avoids BSON subdocument mutation issues
        let newLevel = acc.pet.level || 1;
        let newXp    = (acc.pet.xp || 0) + gainedXp;

        // Level up loop
        let levelUps = 0;
        while (newXp >= petXpToLevel(newLevel)) {
            newXp -= petXpToLevel(newLevel);
            newLevel += 1;
            levelUps++;
        }

        // Reconstruct entire pet object — guarantees $set saves every field
        acc.pet = {
            type:        acc.pet.type,
            nickname:    acc.pet.nickname    || null,
            level:       newLevel,
            xp:          newXp,
            adoptedAt:   acc.pet.adoptedAt   || now(),
            lastFed:     acc.pet.lastFed     || 0,
            lastTrained: now(),
            injured:     focus === 'attack' && Math.random() < 0.15,
        };

        logFinancial(acc, `Pet training: ${p.name} (${focus})`, -TRAIN_COST);
        await saveAccount(acc);

        const newPower    = petLevelPower(p.power, newLevel);
        const newXpNeeded = petXpToLevel(newLevel);

        const focusFlavour = {
            attack:  ['sparred against a training dummy', 'drilled strike combos for an hour', 'practised takedowns relentlessly'],
            defense: ['trained blocking drills', 'hardened up against padded attacks', 'practised dodging and counter-stancing'],
            speed:   ['sprinted laps around the dojo', 'practised quick-reaction exercises', 'worked on agility and footwork'],
        };
        const flavour = focusFlavour[focus][Math.floor(Math.random() * 3)];

        let out = [
            `${p.icon} *PET TRAINING COMPLETE!*`,
            ``,
            `*${petName}* ${flavour}.`,
            `💰 Cost: ${fmtMoney(TRAIN_COST)} | 📈 XP gained: +${gainedXp}`,
            ``,
        ];

        if (levelUps > 0) {
            out.push(`🎉 *LEVEL UP!* ${petName} reached *Level ${newLevel}*!`);
            out.push(`⚔️ Combat Power: *${newPower} dmg* per round (+${Math.floor(p.power * 0.12 * levelUps)} from level up)`);
        } else {
            out.push(`Level: ${newLevel} | XP: ${newXp}/${newXpNeeded}`);
            out.push(`⚔️ Power: *${newPower} dmg* | Next level in ${newXpNeeded - newXp} XP`);
        }

        if (injuryLine) out.push(injuryLine);

        return reply(out.join('\n'));
    } catch(e) { console.error('pettrain error', e); }
}
cmd({ pattern: 'pettrain',  desc: 'Train your pet to make it stronger', category: 'rpg', filename: __filename }, handlePetTrainCmd);
cmd({ pattern: 'trainpet',  desc: 'Train your pet (alias: pettrain)',   category: 'rpg', filename: __filename }, handlePetTrainCmd);

// ── OBBY (Obstacle Course) ────────────────────────────────────────────────────
// A timed obstacle course. Run it and get a cash reward based on your speed stat.
// 30-min cooldown. Harder difficulties cost energy but pay more.
const OBBY_TIERS = [
  { name: 'Beginner',   energy: 10, baseReward: iC(2000),  speedReq: 0   },
  { name: 'Normal',     energy: 20, baseReward: iC(8000),  speedReq: 20  },
  { name: 'Hard',       energy: 35, baseReward: iC(25000), speedReq: 50  },
  { name: 'Insane',     energy: 50, baseReward: iC(80000), speedReq: 100 },
  { name: 'Impossible', energy: 80, baseReward: iC(250000),speedReq: 200 },
];

cmd({ pattern: "obby", desc: "obby [difficulty] — run an obstacle course for cash", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id  = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);
      if (isHospitalized(acc)) return reply(`🚨 Can't run an obby from jail.`);
      if (isKidnapped(acc))    return reply(`🔒 You're kidnapped. Escape first.`);

      const COOLDOWN = 30 * 60 * 1000;
      const last = acc.cooldowns?.obby || 0;
      if (now() - last < COOLDOWN) return reply(`⏳ Catching your breath. Obby available in ${msToTime(COOLDOWN - (now()-last))}.`);

      const spd = (acc.speed || 3) + (getEconGearBonus(acc).spdBonus || 0) + (getPetBonus(acc).spdBonus || 0);
      const diffArg = (args[0] || '').toLowerCase();
      const available = OBBY_TIERS.filter(t => spd >= t.speedReq);

      if (!diffArg) {
          let list = OBBY_TIERS.map(t => {
              const lock = spd < t.speedReq ? `🔒 Need ${t.speedReq} Spd` : `✅ Available`;
              return `• *${t.name}* — ${fmtMoney(t.baseReward)} reward | ${t.energy} energy | ${lock}`;
          }).join('\n');
          return reply([`🏃 *OBBY — OBSTACLE COURSE*`, ``, `Your Speed: ${spd}`, ``, list, ``, `Run with: *obby <difficulty>* (e.g. obby hard)`].join('\n'));
      }

      const tier = OBBY_TIERS.find(t => t.name.toLowerCase() === diffArg);
      if (!tier) return reply(`Unknown difficulty. Try: beginner, normal, hard, insane, impossible`);
      if (spd < tier.speedReq) return reply(`🔒 *${tier.name}* requires ${tier.speedReq} Speed. You have ${spd}.`);
      if ((acc.energy || 0) < tier.energy) return reply(`⚡ Not enough energy. Need ${tier.energy}, have ${acc.energy || 0}.`);

      acc.energy -= tier.energy;
      acc.cooldowns = acc.cooldowns || {};
      acc.cooldowns.obby = now();

      // Speed-based completion: higher speed = faster clear = bigger bonus
      const speedBonus = Math.floor((spd / Math.max(tier.speedReq, 1)) * 0.5 * tier.baseReward);
      const totalGross = tier.baseReward + speedBonus;
      const { net, vat } = applyVAT(totalGross);

      const FAIL_CHANCE = 0.15; // 15% chance to wipe out on a tricky jump
      if (Math.random() < FAIL_CHANCE) {
          const dmg = 10 + Math.floor(Math.random() * 20);
          acc.health = Math.max(1, (acc.health || 100) - dmg);
          await saveAccount(acc);
          return reply([
              `💥 *OBBY FAILED!*`,
              ``,
              `You wiped out on the *${tier.name}* course!`,
              `❤️ Took ${dmg} fall damage. HP: ${acc.health}`,
              ``,
              `Try again in 30 minutes.`
          ].join('\n'));
      }

      acc.money += net;
      addTaxableIncome(acc, net);
      logFinancial(acc, `Obby completion: ${tier.name}`, net);
      await saveAccount(acc);
      return reply([
          `🏆 *OBBY COMPLETE!*`,
          ``,
          `Course: *${tier.name}*`,
          `Speed: ${spd} | Energy used: ${tier.energy}`,
          ``,
          `Base: ${fmtMoney(tier.baseReward)} + Speed bonus: ${fmtMoney(speedBonus)}`,
          `VAT: -${fmtMoney(vat)} = *${fmtMoney(net)} net*`,
      ].join('\n'));
  } catch(e) { console.error('obby error', e); }
});

// ── TYCOON — Passive business empire ─────────────────────────────────────────
// Buy tycoon upgrades. Each one increases your passive income per claim tick.
// tycoon buy <upgrade> | tycoon claim | tycoon status
const TYCOON_UPGRADES = [
  { id: 'droppers',   name: 'Droppers',       price: iC(10000),   incomePerMin: 50,   desc: 'Drops bricks for cash. Basic income.' },
  { id: 'conveyor',   name: 'Conveyor Belt',  price: iC(50000),   incomePerMin: 200,  desc: 'Speeds up production.' },
  { id: 'factory',    name: 'Factory Floor',  price: iC(200000),  incomePerMin: 800,  desc: 'Mass production unlocked.' },
  { id: 'vault',      name: 'Money Vault',    price: iC(750000),  incomePerMin: 2500, desc: 'Secure vault multiplies output.' },
  { id: 'launcher',   name: 'Cash Launcher',  price: iC(3000000), incomePerMin: 8000, desc: 'Launches cash directly into your wallet.' },
  { id: 'megafactory',name: 'Mega Factory',   price: iC(15000000),incomePerMin: 35000,desc: 'Industrial empire. Top tier.' },
];

cmd({ pattern: "tycoon", desc: "tycoon status | tycoon buy <upgrade> | tycoon claim", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id  = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);
      const sub = (args[0] || 'status').toLowerCase();

      // Calculate total tycoon income per minute
      function tycoonIncome(t) {
          let total = 0;
          for (const u of TYCOON_UPGRADES) {
              if (t?.[u.id]) total += u.incomePerMin;
          }
          return total;
      }

      const tycoon = acc.tycoon || {};

      if (sub === 'status') {
          const perMin = tycoonIncome(tycoon);
          const owned  = TYCOON_UPGRADES.filter(u => tycoon[u.id]);
          const lastClaim = tycoon.lastClaim || 0;
          const unclaimed = Math.floor((now() - lastClaim) / 60000) * perMin;

          let upgradeList = TYCOON_UPGRADES.map(u => {
              return `${tycoon[u.id] ? '✅' : '⬜'} *${u.name}* — ${fmtMoney(u.price)} | +${fmtMoney(u.incomePerMin)}/min`;
          }).join('\n');

          return reply([
              `🏭 *YOUR TYCOON*`,
              ``,
              owned.length === 0 ? `No upgrades yet.` : `Owned: ${owned.map(u => u.name).join(', ')}`,
              `💰 Income: *${fmtMoney(perMin)}/min*`,
              `📦 Unclaimed: *${fmtMoney(unclaimed)}*`,
              ``,
              `*UPGRADES:*`,
              upgradeList,
              ``,
              `Buy: *tycoon buy <upgrade>*`,
              `Collect: *tycoon claim*`
          ].join('\n'));
      }

      if (sub === 'claim') {
          const perMin = tycoonIncome(tycoon);
          if (perMin === 0) return reply(`🏭 Your tycoon earns nothing yet. Buy upgrades with: *tycoon buy <upgrade>*`);
          const lastClaim = tycoon.lastClaim || now();
          const minElapsed = Math.floor((now() - lastClaim) / 60000);
          if (minElapsed < 1) return reply(`⏳ Nothing to claim yet. Tycoon pays out every minute.`);
          const earned = Math.min(minElapsed * perMin, perMin * 1440); // cap at 24h
          const { net, vat } = applyVAT(earned);
          acc.money += net;
          addTaxableIncome(acc, net);
          acc.tycoon = { ...tycoon, lastClaim: now() };
          logFinancial(acc, `Tycoon claim (${minElapsed} min)`, net);
          await saveAccount(acc);
          return reply([
              `🏭 *TYCOON PAYOUT!*`,
              ``,
              `Time since last claim: ${minElapsed} minutes`,
              `Rate: ${fmtMoney(perMin)}/min`,
              `Gross: ${fmtMoney(earned)} — VAT: -${fmtMoney(vat)} = *${fmtMoney(net)} net*`
          ].join('\n'));
      }

      if (sub === 'buy') {
          const upgradeId = (args[1] || '').toLowerCase();
          const upgrade   = TYCOON_UPGRADES.find(u => u.id === upgradeId);
          if (!upgrade) return reply(`Unknown upgrade. Options: ${TYCOON_UPGRADES.map(u => u.id).join(', ')}`);
          if (tycoon[upgradeId]) return reply(`✅ You already own *${upgrade.name}*.`);
          if (acc.money < upgrade.price) return reply(`💸 *${upgrade.name}* costs ${fmtMoney(upgrade.price)}. You have ${fmtMoney(acc.money)}.`);
          acc.money -= upgrade.price;
          acc.moneySpent = (acc.moneySpent || 0) + upgrade.price;
          acc.tycoon = { ...tycoon, [upgradeId]: true, lastClaim: tycoon.lastClaim || now() };
          logFinancial(acc, `Tycoon upgrade: ${upgrade.name}`, -upgrade.price);
          await saveAccount(acc);
          const newIncome = tycoonIncome(acc.tycoon);
          return reply([
              `🏭 *UPGRADE PURCHASED!*`,
              ``,
              `*${upgrade.name}* installed!`,
              `${upgrade.desc}`,
              ``,
              `New income rate: *${fmtMoney(newIncome)}/min*`,
              `Collect earnings with: *tycoon claim*`
          ].join('\n'));
      }

      return reply(`Usage: tycoon status | tycoon buy <upgrade> | tycoon claim`);
  } catch(e) { console.error('tycoon error', e); }
});

// ── SWORD FIGHT (Roblox classic) ─────────────────────────────────────────────
// Quick 1v1 duel with swords — no stats needed, pure RNG with skill element.
// Win streaks give multiplier bonuses. 5-min cooldown.
cmd({ pattern: "swordfight", desc: "swordfight @player — classic Roblox-style sword duel", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id       = await getPlayerId(conn, m.sender);
      const targetId = await getTargetId(conn, mek, args, 0);
      if (!targetId) return reply(`Usage: swordfight @player\n\n⚔️ A classic sword fight. No weapons or stats required.\nWin streaks build a multiplier for bigger rewards.`);
      if (targetId === id) return reply(`You can't sword fight yourself.`);

      const acc    = await getAccount(id);
      const target = await getAccount(targetId);

      if (isHospitalized(acc)) return reply(`🚨 You're in hospital.`);
      if (isKidnapped(acc))    return reply(`🔒 You're kidnapped.`);

      const myCity  = normLoc(acc.location);
      const vicCity = normLoc(target.location);
      if (myCity !== vicCity) return reply(`🌍 Must be in the same city to sword fight.`);

      const COOLDOWN = 5 * 60 * 1000;
      const last = acc.cooldowns?.swordfight || 0;
      if (now() - last < COOLDOWN) return reply(`⏳ Cooldown: ${msToTime(COOLDOWN - (now()-last))}`);

      acc.cooldowns = acc.cooldowns || {};
      acc.cooldowns.swordfight = now();

      // Speed + dex lightly influence outcome but it's mostly even
      const myScore  = Math.random() * 100 + ((acc.speed || 3) + (acc.dexterity || 3)) * 0.5;
      const vicScore = Math.random() * 100 + ((target.speed || 3) + (target.dexterity || 3)) * 0.5;

      const wonStreak = (acc.swordStreak || 0);
      const mult = 1 + Math.min(wonStreak * 0.25, 2.0); // up to 3× at 8 wins

      const BASE_REWARD = iC(3000);

      if (myScore > vicScore) {
          const reward = Math.floor(BASE_REWARD * mult);
          acc.money += reward;
          addTaxableIncome(acc, reward);
          acc.swordStreak = wonStreak + 1;
          target.swordStreak = 0;
          // loser takes small HP hit
          target.health = Math.max(1, (target.health || 100) - 5);
          logFinancial(acc, `Sword fight win vs @${targetId}`, reward);
          await saveAccount(acc);
          await saveAccount(target);
          return conn.sendMessage(m.chat, {
              text: [
                  `⚔️ *SWORD FIGHT!*`,
                  ``,
                  `@${id} vs @${targetId}`,
                  ``,
                  `🏆 *@${id} wins!*`,
                  `💰 Reward: *${fmtMoney(reward)}* (${mult.toFixed(2)}× streak multiplier)`,
                  `🔥 Win streak: *${acc.swordStreak}*`,
                  ``,
                  acc.swordStreak >= 3 ? `🎯 You're on fire! Keep it up.` : ``,
              ].filter(Boolean).join('\n'),
              mentions: [toJid(id), toJid(targetId)]
          }, { quoted: mek });
      } else {
          acc.swordStreak = 0;
          acc.health = Math.max(1, (acc.health || 100) - 5);
          await saveAccount(acc);
          await saveAccount(target);
          return conn.sendMessage(m.chat, {
              text: [
                  `⚔️ *SWORD FIGHT!*`,
                  ``,
                  `@${id} vs @${targetId}`,
                  ``,
                  `💀 *@${id} got eliminated!* @${targetId} wins.`,
                  `Win streak reset to 0.`
              ].join('\n'),
              mentions: [toJid(id), toJid(targetId)]
          }, { quoted: mek });
      }
  } catch(e) { console.error('swordfight error', e); }
});

// ── WORK AT A PIZZA PLACE (Roblox tribute) ────────────────────────────────────
// Mini jobs with flavour text. Different roles each time, animated-style output.
// 15-min cooldown, separate from regular shift.
const PIZZA_ROLES = [
  { role: 'Cashier',         lines: ['You smiled at customers aggressively.', 'Two people asked for refunds. You denied both.'], pay: [800, 1500] },
  { role: 'Delivery Driver', lines: ['You drove 90mph on a scooter.', 'The pizza was upside down but still warm.'], pay: [1200, 2500] },
  { role: 'Cook',            lines: ['You burned three pizzas.', 'The fourth one was *incredible*.'], pay: [1000, 2000] },
  { role: 'Manager',         lines: ['You fired two people then rehired them.', 'Revenue up 4%. You took all the credit.'], pay: [2000, 4000] },
  { role: 'Toppings Expert', lines: ['You put pineapple on everything.', 'Half the staff quit. Productivity improved.'], pay: [900, 1800] },
  { role: 'Box Folder',      lines: ['You folded 800 boxes.', 'Your thumbs now operate at a professional level.'], pay: [600, 1200] },
];

async function handlePizzaJobCmd(conn, mek, m, { reply }) {
  try {
      const id  = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);
      if (isHospitalized(acc)) return reply(`🚨 Can't deliver pizza from hospital.`);
      if (isKidnapped(acc))    return reply(`🔒 You're kidnapped.`);

      const COOLDOWN = 15 * 60 * 1000;
      const last = acc.cooldowns?.pizzajob || 0;
      if (now() - last < COOLDOWN) return reply(`⏳ Your shift starts in ${msToTime(COOLDOWN - (now()-last))}.`);

      const job = PIZZA_ROLES[Math.floor(Math.random() * PIZZA_ROLES.length)];
      const gross = job.pay[0] + Math.floor(Math.random() * (job.pay[1] - job.pay[0]));
      const { net, vat } = applyVAT(gross);

      acc.money += net;
      addTaxableIncome(acc, net);
      acc.cooldowns = acc.cooldowns || {};
      acc.cooldowns.pizzajob = now();
      logFinancial(acc, `Pizza Place: ${job.role}`, net);
      await saveAccount(acc);

      return reply([
          `🍕 *WORK AT A PIZZA PLACE*`,
          ``,
          `Role: *${job.role}*`,
          ``,
          `📋 Shift Report:`,
          ...job.lines.map(l => `   • ${l}`),
          ``,
          `Gross: ${fmtMoney(gross)} — VAT: -${fmtMoney(vat)} = *${fmtMoney(net)}*`,
          `Next shift in 15 minutes.`
      ].join('\n'));
  } catch(e) { console.error('pizzajob error', e); }
}
cmd({ pattern: 'pizzajob',    desc: 'Work at a pizza place (Roblox)', category: 'rpg', filename: __filename }, handlePizzaJobCmd);
cmd({ pattern: 'workatpizza', desc: 'Pizza job (alias: pizzajob)',    category: 'rpg', filename: __filename }, handlePizzaJobCmd);

// ── JAILBREAK (Roblox tribute) ────────────────────────────────────────────────
// If you're in jail, attempt a Roblox-style jailbreak. Riskier than bailout
// but free if it works. Others can help break you out.
cmd({ pattern: "jailbreak", desc: "Attempt a Roblox-style jailbreak from prison", category: "rpg", filename: __filename }, async (conn, mek, m, { args, reply }) => {
  try {
      const id = await getPlayerId(conn, m.sender);
      const acc = await getAccount(id);

      // Can also jailbreak someone else
      const targetId = await getTargetId(conn, mek, args, 0).catch(() => null);
      const isExternal = targetId && targetId !== id;
      const prisoner   = isExternal ? await getAccount(targetId) : acc;
      const prisonerId = isExternal ? targetId : id;

      if (isExternal && !isHospitalized(prisoner)) return reply(`@${targetId} isn't in jail.`);
      if (!isExternal && !isHospitalized(acc))     return reply(`You're not in jail. Nothing to break out of.`);
      if (!isExternal && isKidnapped(acc))         return reply(`🔒 You're kidnapped, not jailed. Use escape instead.`);

      const COOLDOWN = 15 * 60 * 1000;
      const last = acc.cooldowns?.jailbreak || 0;
      if (now() - last < COOLDOWN) return reply(`⏳ Last attempt failed. Lay low for ${msToTime(COOLDOWN - (now()-last))}.`);

      acc.cooldowns = acc.cooldowns || {};
      acc.cooldowns.jailbreak = now();

      const spd    = (acc.speed || 3) + (getEconGearBonus(acc).spdBonus || 0);
      const chance = Math.min(0.70, 0.25 + (spd / 300));

      if (Math.random() < chance) {
          prisoner.jailedUntil = 0;
          prisoner.health      = Math.max(prisoner.health || 1, 20);
          await saveAccount(prisoner);
          if (isExternal) await saveAccount(acc);
          else await saveAccount(acc);

          const flavour = [
              'You hot-wired a police car and drove through the front gate.',
              'You used a rubber duck as a distraction. It worked.',
              'You dug a tunnel in 45 seconds using a plastic spoon.',
              'You told the guard you were the warden\'s nephew. He believed you.',
          ][Math.floor(Math.random() * 4)];

          return conn.sendMessage(m.chat, {
              text: [
                  `🚨 *JAILBREAK SUCCESSFUL!*`,
                  ``,
                  isExternal ? `@${id} broke @${prisonerId} out of jail!` : `You broke out of jail!`,
                  ``,
                  `📖 *${flavour}*`,
                  ``,
                  isExternal ? `@${prisonerId} is free!` : `You're free! Don't get caught again.`
              ].join('\n'),
              mentions: isExternal ? [toJid(id), toJid(prisonerId)] : [toJid(id)]
          }, { quoted: mek });
      } else {
          // Failed — extra jail time added
          const extra = 5 * 60 * 1000;
          if (!isExternal) {
              acc.jailedUntil = (acc.jailedUntil || now()) + extra;
          }
          await saveAccount(acc);
          const failFlavour = [
              'You slipped on a wet floor in the hallway.',
              'The guard dog was unimpressed by your disguise.',
              'You forgot which way was out.',
              'Security spotted you immediately. You were wearing a striped shirt.',
          ][Math.floor(Math.random() * 4)];
          return reply([
              `🚨 *JAILBREAK FAILED!*`,
              ``,
              `📖 *${failFlavour}*`,
              ``,
              isExternal ? `@${prisonerId} is still locked up.` : `+5 minutes added to your sentence.`,
          ].join('\n'));
      }
  } catch(e) { console.error('jailbreak error', e); }
});

// =============================================================================
// MESSAGE EXP ENGINE
const msgExpThrottle = new Map();
function canAwardMsgExp(group, user) {
  const k = `${group}|${user}`;
  const last = msgExpThrottle.get(k) || 0;
  if (now() - last < 60*1000) return false;
  msgExpThrottle.set(k, now());
  return true;
}

function registerEconomy(conn) {
  try {
    conn.ev.on("messages.upsert", async (up) => {
      try {
        const mek = up.messages[0];
        if (!mek || !mek.message) return;
        const from = mek.key.remoteJid;
        if (!from || !from.endsWith("@g.us")) return;

        const sender = mek.key.participant || mek.key.remoteJid;
        if (!sender) return;
        if (!canAwardMsgExp(from, sender)) return;

        const id = await getPlayerId(conn, sender);
        const acc = await getAccount(id);

        if (isHospitalized(acc)) return;
        if (isKidnapped(acc)) return;

        const leveled = await addExp(acc, 1);
        if (leveled) {
            conn.sendMessage(from, { text: `🎉 @${id} has leveled up to Level ${acc.level} through active chatting!`, mentions: [toJid(id)] }, { quoted: mek });
        }
      } catch (e) { }
    });
    console.log("✅ Economy/RPG: registered message EXP listener.");
  } catch (e) {
    console.error("Economy/RPG: failed to register listener", e);
  }
}

// exports
module.exports = {
  getAccount,
  saveAccount,
  registerEconomy
};

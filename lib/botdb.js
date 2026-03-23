// lib/botdb.js — Single source of truth: every persistent setting lives here.
// Uses better-sqlite3 (sync, fast, no async needed).
// Auto-migrates ALL legacy JSON files on first boot.

'use strict';

const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DATABASE_URL?.startsWith('./') || process.env.DATABASE_URL?.startsWith('/') 
  ? path.resolve(process.cwd(), process.env.DATABASE_URL.replace(/^\.\//, ''))
  : path.resolve(process.cwd(), 'data', 'nexus.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous  = NORMAL');

// ── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  -- generic key/value (bot settings, autoview, autosticker, autovoice …)
  CREATE TABLE IF NOT EXISTS key_value (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  -- sudo users (number only, no @s.whatsapp.net)
  CREATE TABLE IF NOT EXISTS sudo_users (
    user_number TEXT PRIMARY KEY
  );

  -- per-group moderation defaults (badword action, warn limit …)
  CREATE TABLE IF NOT EXISTS group_settings (
    group_jid      TEXT PRIMARY KEY,
    badword_action TEXT    NOT NULL DEFAULT 'warn',
    delete_on_warn INTEGER NOT NULL DEFAULT 1,
    warn_limit     INTEGER NOT NULL DEFAULT 3,
    on_warn_limit  TEXT    NOT NULL DEFAULT 'kick',
    antitag        INTEGER NOT NULL DEFAULT 0,
    antitag_action TEXT    NOT NULL DEFAULT 'delete'
  );

  -- per-group badwords (group_jid='*' = global)
  CREATE TABLE IF NOT EXISTS group_badwords (
    group_jid TEXT NOT NULL,
    word      TEXT NOT NULL,
    PRIMARY KEY (group_jid, word)
  );

  -- badword / warn counts per group per user
  CREATE TABLE IF NOT EXISTS warnings (
    group_jid TEXT    NOT NULL,
    user_jid  TEXT    NOT NULL,
    count     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (group_jid, user_jid)
  );

  -- global blacklist
  CREATE TABLE IF NOT EXISTS blacklist (
    user_jid TEXT PRIMARY KEY,
    reason   TEXT NOT NULL DEFAULT ''
  );

  -- welcome/goodbye per group
  CREATE TABLE IF NOT EXISTS group_greetings (
    group_jid       TEXT PRIMARY KEY,
    welcome_enabled INTEGER NOT NULL DEFAULT 0,
    welcome_msg     TEXT    NOT NULL DEFAULT '',
    goodbye_enabled INTEGER NOT NULL DEFAULT 0,
    goodbye_msg     TEXT    NOT NULL DEFAULT ''
  );

  -- per-group feature toggles: antigroupmention, antinewsletter, antilink
  CREATE TABLE IF NOT EXISTS group_features (
    group_jid TEXT NOT NULL,
    feature   TEXT NOT NULL,   -- 'antigroupmention' | 'antinewsletter' | 'antilink'
    enabled   INTEGER NOT NULL DEFAULT 0,
    mode      TEXT    NOT NULL DEFAULT '',  -- antilink/antinewsletter: kick|delete|warn|off
    PRIMARY KEY (group_jid, feature)
  );

  -- per-group per-user warn counts for features (antilink, antigroupmention)
  CREATE TABLE IF NOT EXISTS feature_warns (
    group_jid TEXT    NOT NULL,
    feature   TEXT    NOT NULL,
    user_jid  TEXT    NOT NULL,
    count     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (group_jid, feature, user_jid)
  );

  -- message activity counts per group per user
  CREATE TABLE IF NOT EXISTS activity (
    group_jid TEXT    NOT NULL,
    user_jid  TEXT    NOT NULL,
    count     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (group_jid, user_jid)
  );

  -- WCG game state (one JSON blob per group)
  CREATE TABLE IF NOT EXISTS wcg_games (
    group_jid TEXT PRIMARY KEY,
    state     TEXT NOT NULL DEFAULT '{}'
  );

  -- WCG player stats
  CREATE TABLE IF NOT EXISTS wcg_stats (
    user_jid TEXT PRIMARY KEY,
    wins     INTEGER NOT NULL DEFAULT 0,
    losses   INTEGER NOT NULL DEFAULT 0,
    played   INTEGER NOT NULL DEFAULT 0
  );

  -- Tic Tac Toe leaderboard
  CREATE TABLE IF NOT EXISTS ttt_leaderboard (
    user_jid TEXT PRIMARY KEY,
    wins     INTEGER NOT NULL DEFAULT 0,
    losses   INTEGER NOT NULL DEFAULT 0,
    draws    INTEGER NOT NULL DEFAULT 0
  );

  -- Daily activity (per-group per-user per-day message counts)
  CREATE TABLE IF NOT EXISTS daily_activity (
    group_jid TEXT    NOT NULL,
    user_jid  TEXT    NOT NULL,
    date      TEXT    NOT NULL,
    count     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (group_jid, user_jid, date)
  );

  -- Antistatus (auto-react/view status settings per user/chat)
  CREATE TABLE IF NOT EXISTS antistatus (
    chat_jid TEXT PRIMARY KEY,
    mode     TEXT NOT NULL DEFAULT 'off'
  );

  -- migration tracker
  CREATE TABLE IF NOT EXISTS migrations (
    name   TEXT PRIMARY KEY,
    ran_at TEXT NOT NULL
  );

  -- Keyword filters per group
  CREATE TABLE IF NOT EXISTS filters (
    group_jid TEXT NOT NULL,
    keyword   TEXT NOT NULL,
    response  TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (group_jid, keyword)
  );

  -- Notes per group
  CREATE TABLE IF NOT EXISTS notes (
    group_jid TEXT    NOT NULL,
    name      TEXT    NOT NULL,
    content   TEXT    NOT NULL DEFAULT '',
    saved_at  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (group_jid, name)
  );

  -- Persistent reminders
  CREATE TABLE IF NOT EXISTS reminders (
    id       TEXT    PRIMARY KEY,
    sender   TEXT    NOT NULL,
    chat_jid TEXT    NOT NULL,
    message  TEXT    NOT NULL,
    fire_at  INTEGER NOT NULL
  );

  -- anticall settings per bot number
  CREATE TABLE IF NOT EXISTS anticall (
    bot_number TEXT PRIMARY KEY,
    mode       TEXT NOT NULL DEFAULT 'false'
  );
`);

// ── Migration helpers ─────────────────────────────────────────────────────────
function migrationRan(name) {
  return !!db.prepare('SELECT 1 FROM migrations WHERE name=?').get(name);
}
function markMigration(name) {
  db.prepare("INSERT OR IGNORE INTO migrations (name,ran_at) VALUES (?,datetime('now'))").run(name);
}
function safeJson(p, fallback) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p,'utf8') || 'null') ?? fallback;
  } catch(_) {}
  return fallback;
}

// ── Run all JSON → SQLite migrations on first boot ───────────────────────────
(function runMigrations() {

  // 1. warnings.json
  if (!migrationRan('warnings_json')) {
    const raw = safeJson(path.resolve(process.cwd(),'lib','warnings.json'), {chats:{}});
    const ins  = db.prepare('INSERT OR IGNORE INTO warnings (group_jid,user_jid,count) VALUES (?,?,?)');
    const insS = db.prepare('INSERT OR IGNORE INTO group_settings (group_jid,warn_limit) VALUES (?,?)');
    db.transaction(chats => {
      for (const [gid,d] of Object.entries(chats)) {
        if (!gid||!d) continue;
        if (d.warnLimit) insS.run(gid, d.warnLimit);
        for (const [uid,cnt] of Object.entries(d.warnings||{}))
          if (uid && cnt>0) ins.run(gid, uid, cnt);
      }
    })(raw.chats||{});
    markMigration('warnings_json');
    console.log('✅ Migrated warnings.json');
  }

  // 2. badwords.json (global array → '*')
  if (!migrationRan('badwords_json')) {
    const words = safeJson(path.resolve(process.cwd(),'lib','badwords.json'), []);
    const ins   = db.prepare('INSERT OR IGNORE INTO group_badwords (group_jid,word) VALUES (?,?)');
    db.transaction(list => {
      for (const w of list)
        if (w && typeof w==='string' && w.trim()) ins.run('*', w.trim().toLowerCase());
    })(Array.isArray(words)?words:[]);
    markMigration('badwords_json');
    console.log('✅ Migrated badwords.json');
  }

  // 3. blacklist.json
  if (!migrationRan('blacklist_json')) {
    const raw = safeJson(path.resolve(process.cwd(),'lib','blacklist.json'), {users:[]});
    const ins = db.prepare('INSERT OR IGNORE INTO blacklist (user_jid) VALUES (?)');
    db.transaction(u => u.forEach(j => { if(j) ins.run(j); }))(raw.users||[]);
    markMigration('blacklist_json');
    console.log('✅ Migrated blacklist.json');
  }

  // 4. groupMessagesSettings.json → group_greetings
  if (!migrationRan('group_greetings_json')) {
    const raw = safeJson(path.resolve(process.cwd(),'lib','groupMessagesSettings.json'),{welcome:{},goodbye:{}});
    const uW = db.prepare(`INSERT INTO group_greetings (group_jid,welcome_enabled,welcome_msg,goodbye_enabled,goodbye_msg) VALUES (?,?,?,0,'')
      ON CONFLICT(group_jid) DO UPDATE SET welcome_enabled=excluded.welcome_enabled, welcome_msg=excluded.welcome_msg`);
    const uG = db.prepare(`INSERT INTO group_greetings (group_jid,welcome_enabled,welcome_msg,goodbye_enabled,goodbye_msg) VALUES (?,0,'',?,?)
      ON CONFLICT(group_jid) DO UPDATE SET goodbye_enabled=excluded.goodbye_enabled, goodbye_msg=excluded.goodbye_msg`);
    db.transaction((w,g) => {
      for (const [gid,c] of Object.entries(w)) if(gid) uW.run(gid, c.enabled?1:0, c.message||'');
      for (const [gid,c] of Object.entries(g)) if(gid) uG.run(gid, c.enabled?1:0, c.message||'');
    })(raw.welcome||{}, raw.goodbye||{});
    markMigration('group_greetings_json');
    console.log('✅ Migrated groupMessagesSettings.json');
  }

  // 5. systemSettings.json → group_settings global defaults
  if (!migrationRan('system_settings_json')) {
    const raw = safeJson(path.resolve(process.cwd(),'lib','systemSettings.json'),{settings:{}});
    const s   = raw.settings||{};
    db.prepare(`INSERT OR IGNORE INTO group_settings (group_jid,badword_action,delete_on_warn,warn_limit,on_warn_limit) VALUES (?,?,?,?,?)`)
      .run('*', s.badwordAction||'warn', s.deleteOnWarn?1:1, s.warnLimit||3, s.onWarnLimit||'kick');
    markMigration('system_settings_json');
    console.log('✅ Migrated systemSettings.json');
  }

  // 6. sudo.json → sudo_users
  if (!migrationRan('sudo_json')) {
    const raw = safeJson(path.resolve(process.cwd(),'lib','sudo.json'), {});
    const ins = db.prepare('INSERT OR IGNORE INTO sudo_users (user_number) VALUES (?)');
    db.transaction(obj => {
      for (const [num, val] of Object.entries(obj))
        if (val === true && num) ins.run(String(num).replace(/\D/g,''));
    })(raw);
    markMigration('sudo_json');
    console.log('✅ Migrated sudo.json');
  }

  // 7. autoview.json → key_value
  if (!migrationRan('autoview_json')) {
    const raw = safeJson(path.resolve(process.cwd(),'lib','autoview.json'), {enabled:false});
    db.prepare('INSERT OR IGNORE INTO key_value (key,value) VALUES (?,?)').run('autoview_enabled', raw.enabled?'1':'0');
    markMigration('autoview_json');
    console.log('✅ Migrated autoview.json');
  }

  // 8. botSettings.json → key_value
  if (!migrationRan('bot_settings_json')) {
    const raw = safeJson(path.resolve(process.cwd(),'lib','botSettings.json'), {});
    db.prepare('INSERT OR IGNORE INTO key_value (key,value) VALUES (?,?)').run('bot_settings', JSON.stringify(raw));
    markMigration('bot_settings_json');
    console.log('✅ Migrated botSettings.json');
  }

  // 9. antigroupmention.json → group_features + feature_warns
  if (!migrationRan('antigroupmention_json')) {
    const raw  = safeJson(path.resolve(process.cwd(),'lib','antigroupmention.json'), {});
    const insF = db.prepare(`INSERT OR IGNORE INTO group_features (group_jid,feature,enabled,mode) VALUES (?,?,?,?)`);
    const insW = db.prepare('INSERT OR IGNORE INTO feature_warns (group_jid,feature,user_jid,count) VALUES (?,?,?,?)');
    db.transaction(obj => {
      for (const [gid,d] of Object.entries(obj)) {
        if (!gid||!d) continue;
        insF.run(gid, 'antigroupmention', d.enabled?1:0, '');
        for (const [uid,cnt] of Object.entries(d.warns||{}))
          if (uid && cnt>0) insW.run(gid, 'antigroupmention', uid, cnt);
      }
    })(raw);
    markMigration('antigroupmention_json');
    console.log('✅ Migrated antigroupmention.json');
  }

  // 10. antitagSettings.json (antinewsletter) → group_features
  if (!migrationRan('antitag_json')) {
    const raw = safeJson(path.resolve(process.cwd(),'lib','antitagSettings.json'), {});
    const ins = db.prepare(`INSERT OR IGNORE INTO group_features (group_jid,feature,enabled,mode) VALUES (?,?,?,?)`);
    db.transaction(obj => {
      for (const [gid, mode] of Object.entries(obj)) {
        if (!gid) continue;
        const enabled = mode && mode !== 'off' ? 1 : 0;
        ins.run(gid, 'antinewsletter', enabled, mode||'off');
      }
    })(raw);
    markMigration('antitag_json');
    console.log('✅ Migrated antitagSettings.json');
  }

  // 11. database/linkDetection.json → group_features
  if (!migrationRan('linkdetection_json')) {
    const raw = safeJson(path.resolve(process.cwd(),'lib','database','linkDetection.json'), {});
    const ins = db.prepare(`INSERT OR IGNORE INTO group_features (group_jid,feature,enabled,mode) VALUES (?,?,?,?)`);
    db.transaction(obj => {
      for (const [gid, mode] of Object.entries(obj)) {
        if (!gid) continue;
        const enabled = mode && mode !== 'off' ? 1 : 0;
        ins.run(gid, 'antilink', enabled, mode||'off');
      }
    })(raw);
    markMigration('linkdetection_json');
    console.log('✅ Migrated linkDetection.json');
  }

  // 12. activity.json → activity
  if (!migrationRan('activity_json')) {
    const raw = safeJson(path.resolve(process.cwd(),'lib','activity.json'), {});
    const ins = db.prepare('INSERT OR IGNORE INTO activity (group_jid,user_jid,count) VALUES (?,?,?)');
    db.transaction(obj => {
      for (const [gid, users] of Object.entries(obj)) {
        if (!gid || typeof users!=='object') continue;
        for (const [uid, cnt] of Object.entries(users))
          if (uid && cnt>0) ins.run(gid, uid, cnt);
      }
    })(raw);
    markMigration('activity_json');
    console.log('✅ Migrated activity.json');
  }

  // 13. wcg-database.json → wcg_games
  if (!migrationRan('wcg_games_json')) {
    const raw = safeJson(path.resolve(process.cwd(),'lib','wcg-database.json'), {});
    const ins = db.prepare('INSERT OR IGNORE INTO wcg_games (group_jid,state) VALUES (?,?)');
    db.transaction(obj => {
      for (const [gid, state] of Object.entries(obj))
        if (gid) ins.run(gid, JSON.stringify(state));
    })(raw);
    markMigration('wcg_games_json');
    console.log('✅ Migrated wcg-database.json');
  }

  // 14. wcg-stats.json → wcg_stats
  if (!migrationRan('wcg_stats_json')) {
    const raw = safeJson(path.resolve(process.cwd(),'lib','wcg-stats.json'), {});
    const ins = db.prepare('INSERT OR IGNORE INTO wcg_stats (user_jid,wins,losses,played) VALUES (?,?,?,?)');
    db.transaction(obj => {
      for (const [uid,s] of Object.entries(obj))
        if (uid) ins.run(uid, s.wins||0, s.losses||0, s.played||0);
    })(raw);
    markMigration('wcg_stats_json');
    console.log('✅ Migrated wcg-stats.json');
  }

  // 15. autosticker.json → key_value
  if (!migrationRan('autosticker_json')) {
    const raw = safeJson(path.resolve(process.cwd(),'data','autosticker.json'), {});
    db.prepare('INSERT OR IGNORE INTO key_value (key,value) VALUES (?,?)').run('autosticker_data', JSON.stringify(raw));
    markMigration('autosticker_json');
    console.log('✅ Migrated autosticker.json');
  }

  // 16. autovoice.json → key_value
  if (!migrationRan('autovoice_json')) {
    const raw = safeJson(path.resolve(process.cwd(),'data','autovoice.json'), {});
    db.prepare('INSERT OR IGNORE INTO key_value (key,value) VALUES (?,?)').run('autovoice_data', JSON.stringify(raw));
    markMigration('autovoice_json');
    console.log('✅ Migrated autovoice.json');
  }

  // 17. ttt_leaderboard.json → ttt_leaderboard
  if (!migrationRan('ttt_leaderboard_json')) {
    const raw = safeJson(path.resolve(process.cwd(),'data','ttt_leaderboard.json'), {});
    const ins = db.prepare('INSERT OR IGNORE INTO ttt_leaderboard (user_jid,wins,losses,draws) VALUES (?,?,?,?)');
    db.transaction(obj => {
      for (const [uid,s] of Object.entries(obj))
        if (uid) ins.run(uid, s.wins||0, s.losses||0, s.draws||0);
    })(raw);
    markMigration('ttt_leaderboard_json');
    console.log('✅ Migrated ttt_leaderboard.json');
  }

  // 18. antistatus.json → antistatus
  if (!migrationRan('antistatus_json')) {
    const raw = safeJson(path.resolve(process.cwd(),'data','antistatus.json'), {});
    const ins = db.prepare('INSERT OR IGNORE INTO antistatus (chat_jid,mode) VALUES (?,?)');
    db.transaction(obj => {
      for (const [jid,mode] of Object.entries(obj))
        if (jid) ins.run(jid, mode||'off');
    })(raw);
    markMigration('antistatus_json');
    console.log('✅ Migrated antistatus.json');
  }

  // Add antitag columns if missing (for existing DBs)
  if (!migrationRan('antitag_columns')) {
    try { db.prepare('ALTER TABLE group_settings ADD COLUMN antitag INTEGER NOT NULL DEFAULT 0').run(); } catch (_) {}
    try { db.prepare('ALTER TABLE group_settings ADD COLUMN antitag_action TEXT NOT NULL DEFAULT \'delete\'').run(); } catch (_) {}
    markMigration('antitag_columns');
  }

})(); // end migrations


// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

// ── Key / Value ──────────────────────────────────────────────────────────────
function kvGet(key, fallback = null) {
  try {
    const row = db.prepare('SELECT value FROM key_value WHERE key=?').get(key);
    return row ? row.value : fallback;
  } catch { return fallback; }
}
function kvSet(key, value) {
  db.prepare('INSERT INTO key_value (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}
function kvGetJson(key, fallback = {}) {
  try { return JSON.parse(kvGet(key, null) ?? 'null') ?? fallback; }
  catch { return fallback; }
}
function kvSetJson(key, obj) { kvSet(key, JSON.stringify(obj)); }

// ── Bot Settings (runtime, persisted) ────────────────────────────────────────
function getBotSettings() { return kvGetJson('bot_settings', {}); }
function saveBotSettings(obj) { kvSetJson('bot_settings', obj); }

// ── Auto-view ─────────────────────────────────────────────────────────────────
function getAutoview() { return kvGet('autoview_enabled','0') === '1'; }
function setAutoview(enabled) { kvSet('autoview_enabled', enabled ? '1' : '0'); }

// ── Autosticker / Autovoice ───────────────────────────────────────────────────
function getAutosticker() { return kvGetJson('autosticker_data', {}); }
function setAutosticker(obj) { kvSetJson('autosticker_data', obj); }
function getAutovoice() { return kvGetJson('autovoice_data', {}); }
function setAutovoice(obj) { kvSetJson('autovoice_data', obj); }

// ── Sudo users ────────────────────────────────────────────────────────────────
function isSudo(numberOrJid) {
  const n = String(numberOrJid || '').replace(/\D/g,'').replace(/^(\d+):.+$/,'$1');
  return !!db.prepare('SELECT 1 FROM sudo_users WHERE user_number=?').get(n);
}
function addSudo(numberOrJid) {
  const n = String(numberOrJid||'').split('@')[0].replace(/\D/g,'');
  if (n) db.prepare('INSERT OR IGNORE INTO sudo_users (user_number) VALUES (?)').run(n);
}
function removeSudo(numberOrJid) {
  const n = String(numberOrJid||'').split('@')[0].replace(/\D/g,'');
  db.prepare('DELETE FROM sudo_users WHERE user_number=?').run(n);
}
function listSudo() {
  return db.prepare('SELECT user_number FROM sudo_users').all().map(r => r.user_number);
}

// ── Group moderation settings ─────────────────────────────────────────────────
function getGroupSettings(groupJid) {
  const def  = db.prepare("SELECT * FROM group_settings WHERE group_jid='*'").get() ||
    { badword_action:'warn', delete_on_warn:1, warn_limit:3, on_warn_limit:'kick' };
  const spec = groupJid ? db.prepare('SELECT * FROM group_settings WHERE group_jid=?').get(groupJid) : null;
  return { ...def, ...(spec||{}), group_jid: groupJid };
}
function setGroupSetting(groupJid, field, value) {
  const ok = ['badword_action','delete_on_warn','warn_limit','on_warn_limit','antitag','antitag_action'];
  if (!ok.includes(field)) throw new Error('Unknown field: '+field);
  db.prepare(`INSERT INTO group_settings (group_jid,${field}) VALUES (@g,@v) ON CONFLICT(group_jid) DO UPDATE SET ${field}=excluded.${field}`)
    .run({g: groupJid, v: value});
}

// ── Badwords ──────────────────────────────────────────────────────────────────
function getBadwords(groupJid) {
  return db.prepare("SELECT word FROM group_badwords WHERE group_jid=? OR group_jid='*'").all(groupJid).map(r=>r.word);
}
function addBadword(groupJid, word) {
  db.prepare('INSERT OR IGNORE INTO group_badwords (group_jid,word) VALUES (?,?)').run(groupJid||'*', word.toLowerCase().trim());
}
function removeBadword(groupJid, word) {
  const w = word.toLowerCase().trim();
  let i = db.prepare('DELETE FROM group_badwords WHERE group_jid=? AND word=?').run(groupJid||'*', w);
  if (!i.changes) db.prepare("DELETE FROM group_badwords WHERE group_jid='*' AND word=?").run(w);
  return i.changes > 0;
}
function listBadwords(groupJid) {
  return db.prepare("SELECT word,group_jid FROM group_badwords WHERE group_jid=? OR group_jid='*' ORDER BY group_jid,word").all(groupJid);
}

// ── Warnings (badword) ────────────────────────────────────────────────────────
function getWarningCount(groupJid, userJid) {
  const r = db.prepare('SELECT count FROM warnings WHERE group_jid=? AND user_jid=?').get(groupJid, userJid);
  return r ? r.count : 0;
}
function incrementWarning(groupJid, userJid) {
  db.prepare('INSERT INTO warnings (group_jid,user_jid,count) VALUES (?,?,1) ON CONFLICT(group_jid,user_jid) DO UPDATE SET count=count+1').run(groupJid, userJid);
  return getWarningCount(groupJid, userJid);
}
function resetWarning(groupJid, userJid) { db.prepare('DELETE FROM warnings WHERE group_jid=? AND user_jid=?').run(groupJid, userJid); }
function resetAllWarnings(groupJid)      { db.prepare('DELETE FROM warnings WHERE group_jid=?').run(groupJid); }
function listWarnings(groupJid)          { return db.prepare('SELECT user_jid,count FROM warnings WHERE group_jid=? ORDER BY count DESC').all(groupJid); }

// ── Blacklist ─────────────────────────────────────────────────────────────────
function isBlacklisted(userJid)          { return !!db.prepare('SELECT 1 FROM blacklist WHERE user_jid=?').get(userJid); }
function addToBlacklist(userJid, reason='') { db.prepare('INSERT OR IGNORE INTO blacklist (user_jid,reason) VALUES (?,?)').run(userJid, reason); }
function removeFromBlacklist(userJid)    { db.prepare('DELETE FROM blacklist WHERE user_jid=?').run(userJid); }
function getBlacklist()                  { return db.prepare('SELECT user_jid,reason FROM blacklist').all(); }

// ── Greetings ─────────────────────────────────────────────────────────────────
function getGreetings(groupJid) {
  return db.prepare('SELECT * FROM group_greetings WHERE group_jid=?').get(groupJid) ||
    { group_jid:groupJid, welcome_enabled:0, welcome_msg:'', goodbye_enabled:0, goodbye_msg:'' };
}
function setWelcome(groupJid, enabled, msg='') {
  db.prepare(`INSERT INTO group_greetings (group_jid,welcome_enabled,welcome_msg,goodbye_enabled,goodbye_msg) VALUES (@g,@e,@m,0,'')
    ON CONFLICT(group_jid) DO UPDATE SET welcome_enabled=excluded.welcome_enabled, welcome_msg=excluded.welcome_msg`)
    .run({g:groupJid, e:enabled?1:0, m:msg||''});
}
function setGoodbye(groupJid, enabled, msg='') {
  db.prepare(`INSERT INTO group_greetings (group_jid,welcome_enabled,welcome_msg,goodbye_enabled,goodbye_msg) VALUES (@g,0,'',@e,@m)
    ON CONFLICT(group_jid) DO UPDATE SET goodbye_enabled=excluded.goodbye_enabled, goodbye_msg=excluded.goodbye_msg`)
    .run({g:groupJid, e:enabled?1:0, m:msg||''});
}

// ── Group features (antigroupmention, antinewsletter, antilink) ───────────────
function getFeature(groupJid, feature) {
  return db.prepare('SELECT * FROM group_features WHERE group_jid=? AND feature=?').get(groupJid, feature) ||
    { group_jid:groupJid, feature, enabled:0, mode:'' };
}
function setFeature(groupJid, feature, enabled, mode='') {
  db.prepare(`INSERT INTO group_features (group_jid,feature,enabled,mode) VALUES (?,?,?,?)
    ON CONFLICT(group_jid,feature) DO UPDATE SET enabled=excluded.enabled, mode=excluded.mode`)
    .run(groupJid, feature, enabled?1:0, mode||'');
}
function setFeatureMode(groupJid, feature, mode) {
  const enabled = mode && mode !== 'off' ? 1 : 0;
  setFeature(groupJid, feature, enabled, mode);
}

// ── Feature warns (antilink, antigroupmention) ────────────────────────────────
function getFeatureWarn(groupJid, feature, userJid) {
  const r = db.prepare('SELECT count FROM feature_warns WHERE group_jid=? AND feature=? AND user_jid=?').get(groupJid, feature, userJid);
  return r ? r.count : 0;
}
function incrementFeatureWarn(groupJid, feature, userJid) {
  db.prepare('INSERT INTO feature_warns (group_jid,feature,user_jid,count) VALUES (?,?,?,1) ON CONFLICT(group_jid,feature,user_jid) DO UPDATE SET count=count+1')
    .run(groupJid, feature, userJid);
  return getFeatureWarn(groupJid, feature, userJid);
}
function resetFeatureWarn(groupJid, feature, userJid) {
  db.prepare('DELETE FROM feature_warns WHERE group_jid=? AND feature=? AND user_jid=?').run(groupJid, feature, userJid);
}

// ── Activity ──────────────────────────────────────────────────────────────────
function updateActivity(groupJid, userJid) {
  db.prepare('INSERT INTO activity (group_jid,user_jid,count) VALUES (?,?,1) ON CONFLICT(group_jid,user_jid) DO UPDATE SET count=count+1')
    .run(groupJid, userJid);
}
function getActivityList(groupJid) {
  return db.prepare('SELECT user_jid,count FROM activity WHERE group_jid=? ORDER BY count DESC').all(groupJid);
}

// ── WCG Games ─────────────────────────────────────────────────────────────────
function getWCGGame(groupJid) {
  const r = db.prepare('SELECT state FROM wcg_games WHERE group_jid=?').get(groupJid);
  try { return r ? JSON.parse(r.state) : null; } catch { return null; }
}
function setWCGGame(groupJid, state) {
  if (state === null) {
    db.prepare('DELETE FROM wcg_games WHERE group_jid=?').run(groupJid);
  } else {
    db.prepare('INSERT INTO wcg_games (group_jid,state) VALUES (?,?) ON CONFLICT(group_jid) DO UPDATE SET state=excluded.state')
      .run(groupJid, JSON.stringify(state));
  }
}
function deleteWCGGame(groupJid) { db.prepare('DELETE FROM wcg_games WHERE group_jid=?').run(groupJid); }

// ── WCG Stats ─────────────────────────────────────────────────────────────────
function getWCGStats(userJid) {
  return db.prepare('SELECT * FROM wcg_stats WHERE user_jid=?').get(userJid) ||
    { user_jid:userJid, wins:0, losses:0, played:0 };
}
function updateWCGStats(userJid, { win=false, loss=false } = {}) {
  db.prepare(`INSERT INTO wcg_stats (user_jid,wins,losses,played) VALUES (?,?,?,1)
    ON CONFLICT(user_jid) DO UPDATE SET
      wins   = wins   + ${win  ? 1 : 0},
      losses = losses + ${loss ? 1 : 0},
      played = played + 1`)
    .run(userJid, win?1:0, loss?1:0);
}
function getWCGLeaderboard(limit=10) {
  return db.prepare('SELECT * FROM wcg_stats ORDER BY wins DESC LIMIT ?').all(limit);
}

// ── Daily Activity (for myactivity command) ───────────────────────────────────
function addDailyMessage(groupJid, userJid) {
  const date = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO daily_activity (group_jid,user_jid,date,count) VALUES (?,?,?,1)
    ON CONFLICT(group_jid,user_jid,date) DO UPDATE SET count=count+1`)
    .run(groupJid, userJid, date);
}
function getDailyStats(groupJid) {
  const date = new Date().toISOString().slice(0, 10);
  const rows  = db.prepare('SELECT user_jid,count FROM daily_activity WHERE group_jid=? AND date=? ORDER BY count DESC').all(groupJid, date);
  if (!rows.length) return null;
  const users = {};
  let total = 0;
  for (const r of rows) { users[r.user_jid] = r.count; total += r.count; }
  return { total, users };
}

// ── TTT Leaderboard ───────────────────────────────────────────────────────────
function getTTTStats(userJid) {
  return db.prepare('SELECT * FROM ttt_leaderboard WHERE user_jid=?').get(userJid) ||
    { user_jid:userJid, wins:0, losses:0, draws:0 };
}
function updateTTTStats(userJid, result) {
  // result: 'win' | 'loss' | 'draw'
  const w = result==='win'  ? 1:0;
  const l = result==='loss' ? 1:0;
  const d = result==='draw' ? 1:0;
  db.prepare(`INSERT INTO ttt_leaderboard (user_jid,wins,losses,draws) VALUES (?,?,?,?)
    ON CONFLICT(user_jid) DO UPDATE SET wins=wins+${w},losses=losses+${l},draws=draws+${d}`)
    .run(userJid, w, l, d);
}
function getTTTLeaderboard(limit=10) {
  return db.prepare('SELECT * FROM ttt_leaderboard ORDER BY wins DESC LIMIT ?').all(limit);
}

// ── Antistatus ────────────────────────────────────────────────────────────────
function getAntistatusSettings() {
  const rows = db.prepare('SELECT * FROM antistatus').all();
  const out = {};
  for (const r of rows) out[r.chat_jid] = r.mode;
  return out;
}
function setAntistatusMode(chatJid, mode) {
  if (!mode || mode === 'off') {
    db.prepare('DELETE FROM antistatus WHERE chat_jid=?').run(chatJid);
  } else {
    db.prepare('INSERT INTO antistatus (chat_jid,mode) VALUES (?,?) ON CONFLICT(chat_jid) DO UPDATE SET mode=excluded.mode')
      .run(chatJid, mode);
  }
}
function getAntistatusMode(chatJid) {
  const r = db.prepare('SELECT mode FROM antistatus WHERE chat_jid=?').get(chatJid);
  return r ? r.mode : null;
}



// ── Custom sticker trigger ────────────────────────────────────────────────────
function getStickerTrigger(botNum) {
  return kvGetJson(`sticker_trigger:${botNum}`, null);
}
function setStickerTrigger(botNum, data) {
  kvSetJson(`sticker_trigger:${botNum}`, data);
}
function clearStickerTrigger(botNum) {
  kvSet(`sticker_trigger:${botNum}`, null);
}

// ── Font settings ─────────────────────────────────────────────────────────────
function getFont() {
  return parseInt(kvGet('bot:font', '1'), 10) || 1;
}
function setFont(n) {
  kvSet('bot:font', String(Math.max(1, Math.min(5, parseInt(n) || 1))));
}

// ── Filters ──────────────────────────────────────────────────────────────────
function addFilter(gJid, kw, resp) {
  db.prepare('INSERT OR REPLACE INTO filters(group_jid,keyword,response) VALUES(?,?,?)').run(gJid,kw.toLowerCase().trim(),resp);
}
function removeFilter(gJid, kw) {
  return db.prepare('DELETE FROM filters WHERE group_jid=? AND keyword=?').run(gJid,kw.toLowerCase().trim()).changes > 0;
}
function getFilters(gJid) {
  return db.prepare('SELECT keyword,response FROM filters WHERE group_jid=?').all(gJid);
}
function clearFilters(gJid) {
  return db.prepare('DELETE FROM filters WHERE group_jid=?').run(gJid).changes;
}
// ── Notes ─────────────────────────────────────────────────────────────────────
function saveNote(gJid, name, content) {
  db.prepare('INSERT OR REPLACE INTO notes(group_jid,name,content,saved_at) VALUES(?,?,?,?)').run(gJid,name.toLowerCase().trim(),content,Date.now());
}
function getNote(gJid, name) {
  return db.prepare('SELECT * FROM notes WHERE group_jid=? AND name=?').get(gJid,name.toLowerCase().trim());
}
function listNotes(gJid) {
  return db.prepare('SELECT * FROM notes WHERE group_jid=? ORDER BY name').all(gJid);
}
function deleteNote(gJid, name) {
  return db.prepare('DELETE FROM notes WHERE group_jid=? AND name=?').run(gJid,name.toLowerCase().trim()).changes > 0;
}
function clearNotes(gJid) {
  return db.prepare('DELETE FROM notes WHERE group_jid=?').run(gJid).changes;
}
// ── Reminders ─────────────────────────────────────────────────────────────────
function addReminder(id,sender,chatJid,message,fireAt) {
  db.prepare('INSERT OR REPLACE INTO reminders(id,sender,chat_jid,message,fire_at) VALUES(?,?,?,?,?)').run(id,sender,chatJid,message,fireAt);
}
function removeReminder(id) { db.prepare('DELETE FROM reminders WHERE id=?').run(id); }
function getAllReminders() { return db.prepare('SELECT * FROM reminders ORDER BY fire_at ASC').all(); }
function getSenderReminders(sender) { return db.prepare('SELECT * FROM reminders WHERE sender=? ORDER BY fire_at ASC').all(sender); }
// ── AntiCall ──────────────────────────────────────────────────────────────────
function getAntiCall(botNum) {
  return (db.prepare('SELECT mode FROM anticall WHERE bot_number=?').get(botNum)||{mode:'false'}).mode;
}
function setAntiCall(botNum, mode) {
  db.prepare('INSERT OR REPLACE INTO anticall(bot_number,mode) VALUES(?,?)').run(botNum,mode);
}

module.exports = {
  db,
  // KV
  kvGet, kvSet, kvGetJson, kvSetJson,
  // Bot settings
  getBotSettings, saveBotSettings,
  // Autoview
  getAutoview, setAutoview,
  // Autosticker / autovoice
  getAutosticker, setAutosticker,
  getAutovoice,   setAutovoice,
  // Sudo
  isSudo, addSudo, removeSudo, listSudo,
  // Group mod settings
  getGroupSettings, setGroupSetting,
  // Badwords
  getBadwords, addBadword, removeBadword, listBadwords,
  // Warnings
  getWarningCount, incrementWarning, resetWarning, resetAllWarnings, listWarnings,
  // Blacklist
  isBlacklisted, addToBlacklist, removeFromBlacklist, getBlacklist,
  // Greetings
  getGreetings, setWelcome, setGoodbye,
  // Group features
  getFeature, setFeature, setFeatureMode,
  // Feature warns
  getFeatureWarn, incrementFeatureWarn, resetFeatureWarn,
  // Activity
  updateActivity, getActivityList,
  // Daily activity
  addDailyMessage, getDailyStats,
  // WCG
  getWCGGame, setWCGGame, deleteWCGGame,
  getWCGStats, updateWCGStats, getWCGLeaderboard,
  // TTT
  getTTTStats, updateTTTStats, getTTTLeaderboard,
  // Antistatus
  getAntistatusSettings, setAntistatusMode, getAntistatusMode,
  getFont, setFont,
  getStickerTrigger, setStickerTrigger, clearStickerTrigger,
  addFilter, removeFilter, getFilters, clearFilters,
  saveNote, getNote, listNotes, deleteNote, clearNotes,
  addReminder, removeReminder, getAllReminders, getSenderReminders,
  getAntiCall, setAntiCall,
};

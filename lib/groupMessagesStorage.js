// lib/groupMessagesStorage.js — stub only; actual storage is in botdb.js
// Kept for any legacy require() calls that might exist elsewhere.
'use strict';
const botdb = require('./botdb');
function loadSettings() {
  const rows = botdb.db.prepare('SELECT * FROM group_greetings').all();
  const welcome = {}, goodbye = {};
  for (const r of rows) {
    welcome[r.group_jid] = { enabled: !!r.welcome_enabled, message: r.welcome_msg };
    goodbye[r.group_jid] = { enabled: !!r.goodbye_enabled, message: r.goodbye_msg };
  }
  return { welcome, goodbye };
}
function saveSettings(settings) {
  const w = settings.welcome || {};
  const g = settings.goodbye || {};
  for (const [gid, cfg] of Object.entries(w))
    botdb.setWelcome(gid, cfg.enabled, cfg.message||'');
  for (const [gid, cfg] of Object.entries(g))
    botdb.setGoodbye(gid, cfg.enabled, cfg.message||'');
}
module.exports = { loadSettings, saveSettings };

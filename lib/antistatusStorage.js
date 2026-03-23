// lib/antistatusStorage.js — uses botdb (replaces data/antistatus.json)
'use strict';
const botdb = require('./botdb');
function loadSettings() { return botdb.getAntistatusSettings(); }
function saveSettings(data) {
  // data is { chatJid: mode }
  for (const [jid, mode] of Object.entries(data)) {
    botdb.setAntistatusMode(jid, mode);
  }
}
module.exports = { loadSettings, saveSettings };

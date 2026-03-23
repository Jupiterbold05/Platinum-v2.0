// lib/antitagStorage.js — uses botdb group_features (replaces antitagSettings.json)
'use strict';
const botdb = require('./botdb');
function loadSettings() {
  // Return map of groupJid -> mode for backward compat
  const rows = botdb.db.prepare("SELECT group_jid, mode FROM group_features WHERE feature='antinewsletter'").all();
  const out = {};
  for (const r of rows) out[r.group_jid] = r.mode || 'off';
  return out;
}
function saveSettings(obj) {
  // obj is { groupJid: mode }
  for (const [gid, mode] of Object.entries(obj)) {
    botdb.setFeatureMode(gid, 'antinewsletter', mode);
  }
}
module.exports = { loadSettings, saveSettings };

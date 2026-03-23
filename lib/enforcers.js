// lib/enforcers.js — Blacklist enforcement only (badword enforcement is in plugins/mod.js)
// Using unified SQLite DB via lib/botdb.js

'use strict';

const botdb = require('./botdb');

/**
 * handleEnforcement — checks blacklist only.
 * Badword / warning logic lives exclusively in plugins/mod.js (enforceBadwords).
 *
 * Returns { handled: boolean, reason?: string }
 */
async function handleEnforcement(conn, mek, m, { isOwner = false } = {}) {
  try {
    if (isOwner) return { handled: false };

    const from   = mek.key?.remoteJid;
    let sender   = mek.key?.fromMe
      ? (conn.user?.id?.split(':')[0] + '@s.whatsapp.net')
      : (mek.key?.participant || mek.key?.remoteJid);
    if (String(sender).includes(':')) sender = sender.split(':')[0] + '@s.whatsapp.net';

    // Blacklist check (global)
    if (botdb.isBlacklisted(sender) || botdb.isBlacklisted(from)) {
      return { handled: true, reason: 'blacklist' };
    }

    return { handled: false };
  } catch (err) {
    console.error('Enforcer error:', err);
    return { handled: false };
  }
}

module.exports = { handleEnforcement };

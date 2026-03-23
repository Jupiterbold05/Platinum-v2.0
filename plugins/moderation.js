// plugins/mod.js — Per-group moderation: badwords, warnings, blacklist, welcome/goodbye
// All data stored in unified SQLite via lib/botdb.js

'use strict';
const { makeSmartQuote } = require('../cast');

const { cast }       = require('../cast');
const botdb   = require('../lib/botdb');
const config  = require('../config');

// ── Text helpers ─────────────────────────────────────────────────────────────
function normalizeText(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function extractMessageText(mek) {
  try {
    if (mek?.message?.conversation)                  return mek.message.conversation;
    if (mek?.message?.extendedTextMessage?.text)     return mek.message.extendedTextMessage.text;
    if (mek?.message?.imageMessage?.caption)         return mek.message.imageMessage.caption;
    if (mek?.message?.videoMessage?.caption)         return mek.message.videoMessage.caption;
    return '';
  } catch (e) { return ''; }
}
function matchBadword(badwords, text) {
  if (!text || !badwords.length) return null;
  const plain = normalizeText(text);
  for (const w of badwords) {
    const needle = normalizeText(w);
    if (!needle) continue;
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${esc}\\b`, 'i').test(plain) || plain.includes(needle)) return w;
  }
  return null;
}

// ── Delete helper ─────────────────────────────────────────────────────────────
async function tryDelete(conn, mek) {
  try { await conn.sendMessage(mek.key.remoteJid, { delete: mek.key }); return true; }
  catch { return false; }
}

// ── Profile pic helper ───────────────────────────────────────────────────────
async function getDP(conn, jid) {
  try { return await conn.profilePictureUrl(jid, 'image'); }
  catch { return 'https://files.catbox.moe/49gzva.png'; }
}

// ============================================================================
// BADWORD COMMANDS  (group admin or owner only)
// ============================================================================



// ============================================================================
// GROUP PARTICIPANTS EVENT (welcome/goodbye auto-trigger)
// ============================================================================

function handleGroupParticipantsUpdate(conn, update) {
  console.log('[moderation] group-participants.update fired:', JSON.stringify(update).slice(0, 200));
  try {
    const Greetings = require('../lib/Greetings');
    Greetings(update, conn).catch(e =>
      console.error('[moderation] Greetings error:', e.message)
    );
  } catch (e) {
    console.error('[moderation] require Greetings error:', e.message);
  }
}

// ============================================================================
// BADWORD ENFORCEMENT  (group-only, called from index.js per-message)
// ============================================================================

/**
 * enforceBadwords — must only be called for group messages.
 * Returns { handled: boolean, reason?: string }
 */
async function enforceBadwords(conn, mek, m, opts = {}) {
  try {
    const chatId = mek.key?.remoteJid;
    if (!chatId || !chatId.endsWith('@g.us')) return { handled: false };

    // 1. Strictly filter out other groups' words to prevent bleeding
    const badwordsRows = botdb.listBadwords(chatId) || [];
    const badwords = badwordsRows
      .filter(r => r.group_jid === chatId || r.group_jid === '*')
      .map(r => r.word);

    if (!badwords.length) return { handled: false };

    const text = extractMessageText(mek) || m?.text || m?.body || '';
    if (!text) return { handled: false };

    const matched = matchBadword(badwords, text);
    if (!matched) return { handled: false };

    // Exempt owners and admins
    if (opts.isOwner || opts.isAdmins) return { handled: false };

    const senderId = mek.key?.participant || m?.sender;
    if (!senderId) return { handled: false };

    // 2. Add fallback to prevent silent crashes if settings are undefined
    const settings = botdb.getGroupSettings(chatId) || {};
    const action   = settings.badword_action || 'warn';

    async function del() { await tryDelete(conn, mek); }

    if (action === 'none') return { handled: false };

    if (action === 'delete') {
      await del();
      return { handled: true, reason: 'deleted' };
    }

    if (action === 'reply') {
      await del();
      await conn.sendMessage(chatId, {
        text: `⚠️ @${senderId.split('@')[0]} — Bad language not allowed here.`,
        mentions: [senderId]
      }, { quoted: mek }).catch(() => {});
      return { handled: true, reason: 'replied' };
    }

    if (action === 'kick') {
      await conn.groupParticipantsUpdate(chatId, [senderId], 'remove').catch(() => {});
      await conn.sendMessage(chatId, {
        text: `👢 @${senderId.split('@')[0]} removed for using banned words.`,
        mentions: [senderId]
      }, { quoted: mek }).catch(() => {});
      return { handled: true, reason: 'kicked' };
    }

    if (action === 'ban') {
      botdb.addToBlacklist(senderId, 'badword');
      await del();
      await conn.sendMessage(chatId, {
        text: `🚫 @${senderId.split('@')[0]} blacklisted for bad language.`,
        mentions: [senderId]
      }, { quoted: mek }).catch(() => {});
      return { handled: true, reason: 'banned' };
    }

    // 3. Default: warn logic with properly enforced limits
    if (settings.delete_on_warn) await del();
    const count = botdb.incrementWarning(chatId, senderId);
    const limit = settings.warn_limit || 3;
    const warnAction = settings.on_warn_limit || 'kick';

    if (count >= limit) {
      if (warnAction === 'kick') {
        await conn.groupParticipantsUpdate(chatId, [senderId], 'remove').catch(() => {});
        await conn.sendMessage(chatId, {
          text: `👢 @${senderId.split('@')[0]} removed — reached ${count}/${limit} warnings.`,
          mentions: [senderId]
        }, { quoted: mek }).catch(() => {});
        botdb.resetWarning(chatId, senderId);
      } else if (warnAction === 'ban') {
        botdb.addToBlacklist(senderId, 'warn limit');
        await conn.sendMessage(chatId, {
          text: `🚫 @${senderId.split('@')[0]} blacklisted — reached ${count}/${limit} warnings.`,
          mentions: [senderId]
        }, { quoted: mek }).catch(() => {});
        botdb.resetWarning(chatId, senderId);
      } else {
        await conn.sendMessage(chatId, {
          text: `⚠️ @${senderId.split('@')[0]} — Reached max warnings (${count}/${limit}).`,
          mentions: [senderId]
        }, { quoted: mek }).catch(() => {});
        botdb.resetWarning(chatId, senderId);
      }
      return { handled: true, reason: 'warn_limit_reached' };
    }

    await conn.sendMessage(chatId, {
      text: `⚠️ @${senderId.split('@')[0]} — Warning *${count}/${limit}*`,
      mentions: [senderId]
    }, { quoted: mek }).catch(() => {});
    return { handled: true, reason: 'warned' };

  } catch (err) {
    console.error('enforceBadwords error:', err);
    return { handled: false };
  }
}

// ── BAN / UNBAN (botdb-based) ─────────────────────────────────────────────────
cast({
  pattern: 'ban', alias: ['addignorelist','banchat'],
  desc: 'Blacklist and block a user (owner only)',
  category: 'owner', filename: __filename,
}, async (conn, mek, m, { reply, isOwner }) => {
  if (!isOwner) return reply('⛔ Owner only.');
  const target = (m.mentionedJid && m.mentionedJid[0]) || (m.quoted && m.quoted.sender);
  if (!target) return reply('Mention or reply to the user to ban.');
  const jid = target.includes('@') ? target : target.replace(/\D/g,'') + '@s.whatsapp.net';
  botdb.addToBlacklist(jid, 'manual ban');
  try { await conn.updateBlockStatus(jid, 'block').catch(()=>{}); } catch {}
  try {
    if (m.chat?.endsWith('@g.us'))
      await conn.groupParticipantsUpdate(m.chat, [jid], 'remove').catch(()=>{});
  } catch {}
  return reply(`✅ *${jid.split('@')[0]}* has been banned and blocked.`);
});

cast({
  pattern: 'unban', alias: ['delignorelist'],
  desc: 'Remove user from blacklist (owner only)',
  category: 'owner', filename: __filename,
}, async (conn, mek, m, { reply, isOwner }) => {
  if (!isOwner) return reply('⛔ Owner only.');
  const target = (m.mentionedJid && m.mentionedJid[0]) || (m.quoted && m.quoted.sender);
  if (!target) return reply('Mention or reply to the user to unban.');
  const jid = target.includes('@') ? target : target.replace(/\D/g,'') + '@s.whatsapp.net';
  botdb.removeFromBlacklist(jid);
  try { await conn.updateBlockStatus(jid, 'unblock').catch(()=>{}); } catch {}
  return reply(`✅ *${jid.split('@')[0]}* has been unbanned.`);
});

// ── ALWAYSONLINE ──────────────────────────────────────────────────────────────
cast({
  pattern: 'alwaysonline',
  desc: 'Toggle presence heartbeat on/off (owner only)',
  category: 'owner', filename: __filename,
}, async (conn, mek, m, { args, reply, isOwner }) => {
  if (!isOwner) return reply('⛔ Owner only.');
  const opt = (args[0]||'').toLowerCase();
  if (!['on','off'].includes(opt)) return reply('Usage: alwaysonline on/off');
  const s = botdb.getBotSettings(); s.alwaysonline = opt === 'on'; botdb.saveBotSettings(s);
  return reply(`✅ Always-online heartbeat *${opt === 'on' ? 'enabled' : 'disabled'}*.`);
});

// ── SETWARN / LISTWARN (group-specific, via botdb) ────────────────────────────
cast({
  pattern: 'setwarn', alias: ['setwarnlimit2'],
  desc: 'Set warn limit for this group',
  category: 'moderation', filename: __filename,
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, args, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('⚠️ Admins only.');
  const n = parseInt(args[0]);
  if (!n || n < 1 || n > 20) return reply('Provide a valid number (1–20).');
  botdb.setGroupSetting(from, 'warn_limit', n);
  return reply(`✅ Warn limit set to *${n}* for this group.`);
});

cast({
  pattern: 'listwarn', alias: ['warnlist2'],
  desc: 'List warned users in this group',
  category: 'moderation', filename: __filename,
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('⚠️ Admins only.');
  const rows = botdb.listWarnings(from);
  if (!rows.length) return reply('No warnings recorded. 🎉');
  return reply(`*Warnings:*\n${rows.map(r => `• @${r.user_jid.split('@')[0]} — *${r.count}*`).join('\n')}`);
});

module.exports = { enforceBadwords, handleGroupParticipantsUpdate };

// ============================================================================
// MODERATION COMMANDS
// ============================================================================

// ── addbadword ───────────────────────────────────────────────────────────────
cast({
  pattern: 'addbadword', alias: ['badword', 'bw'],
  desc: 'Add a word to the badwords list for this group',
  category: 'moderation', filename: __filename,
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, args, reply }) => {
  if (!isGroup)              return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('⚠️ Admins only.');
  const word = args.join(' ').trim().toLowerCase();
  if (!word) return reply('❗ Usage: addbadword <word>');
  botdb.addBadword(from, word);
  return reply(`✅ *${word}* added to badwords.`);
});

// ── removebadword ────────────────────────────────────────────────────────────
cast({
  pattern: 'removebadword', alias: ['delbadword', 'rmbw'],
  desc: 'Remove a word from the badwords list',
  category: 'moderation', filename: __filename,
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, args, reply }) => {
  if (!isGroup)              return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('⚠️ Admins only.');
  const word = args.join(' ').trim().toLowerCase();
  if (!word) return reply('❗ Usage: removebadword <word>');
  botdb.removeBadword(from, word);
  return reply(`✅ *${word}* removed from badwords.`);
});

// ── badwords ─────────────────────────────────────────────────────────────────
cast({
  pattern: 'badwords', alias: ['listbw', 'bwlist'],
  desc: 'List all badwords for this group',
  category: 'moderation', filename: __filename,
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, reply }) => {
  if (!isGroup)              return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('⚠️ Admins only.');
  const rows = botdb.listBadwords(from).filter(r => r.group_jid === from);
  if (!rows.length) return reply('📭 No badwords set for this group.');
  return reply(`🔞 *Badwords (${rows.length}):*\n${rows.map((r,i) => `${i+1}. ${r.word}`).join('\n')}`);
});

// ── setbadwordaction ─────────────────────────────────────────────────────────
cast({
  pattern: 'setbadwordaction', alias: ['bwaction'],
  desc: 'Set action for badwords: warn | delete | kick | ban | none',
  category: 'moderation', filename: __filename,
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, args, reply }) => {
  if (!isGroup)              return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('⚠️ Admins only.');
  const opt = (args[0] || '').toLowerCase();
  const valid = ['warn','delete','kick','ban','none','reply'];
  if (!valid.includes(opt)) return reply(`❗ Valid actions: ${valid.join(', ')}`);
  botdb.setGroupSetting(from, 'badword_action', opt);
  return reply(`✅ Badword action set to *${opt}*`);
});

// ── setwarnlimit ─────────────────────────────────────────────────────────────
cast({
  pattern: 'setwarnlimit', alias: ['warnlimit'],
  desc: 'Set warning limit before action (default: 3)',
  category: 'moderation', filename: __filename,
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, args, reply }) => {
  if (!isGroup)              return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('⚠️ Admins only.');
  const n = parseInt(args[0]);
  if (!n || n < 1 || n > 20) return reply('❗ Provide a number between 1 and 20.');
  botdb.setGroupSetting(from, 'warn_limit', n);
  return reply(`✅ Warn limit set to *${n}*\n_Applies to: warn command, antilink, antigroupmention, antinewsletter_`);
});

// ── setwarnaction ────────────────────────────────────────────────────────────
cast({
  pattern: 'setwarnaction', alias: ['warnaction'],
  desc: 'Set action when warn limit is reached: kick | ban',
  category: 'moderation', filename: __filename,
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, args, reply }) => {
  if (!isGroup)              return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('⚠️ Admins only.');
  const opt = (args[0] || '').toLowerCase();
  if (!['kick','ban'].includes(opt)) return reply('❗ Valid: kick | ban');
  botdb.setGroupSetting(from, 'on_warn_limit', opt);
  return reply(`✅ Warn limit action set to *${opt}*`);
});

// ── warn ─────────────────────────────────────────────────────────────────────
cast({
  pattern: 'warn',
  desc: 'Warn a group member (mention or reply to their message)',
  category: 'moderation', filename: __filename,
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, reply }) => {
  if (!isGroup)              return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('⚠️ Admins only.');

  const target =
    (m.mentionedJid && m.mentionedJid[0]) ||
    (m.quoted && m.quoted.sender)         || null;
  if (!target) return reply('❗ Mention a user or reply to their message.');

  const settings   = botdb.getGroupSettings(from) || {};
  const limit      = settings.warn_limit    || 3;
  const warnAction = settings.on_warn_limit || 'kick';
  const count      = botdb.incrementWarning(from, target);

  if (count >= limit) {
    if (warnAction === 'kick') {
      await conn.groupParticipantsUpdate(from, [target], 'remove').catch(() => {});
    } else {
      botdb.addToBlacklist(target, 'warn limit');
    }
    botdb.resetWarning(from, target);
    return conn.sendMessage(from, {
      text: `👢 @${target.split('@')[0]} has been *${warnAction === 'kick' ? 'kicked' : 'banned'}* — reached ${limit}/${limit} warnings.`,
      mentions: [target]
    }, { quoted: mek });
  }

  return conn.sendMessage(from, {
    text: `⚠️ @${target.split('@')[0]} — Warning *${count}/${limit}*`,
    mentions: [target]
  }, { quoted: mek });
});

// ── resetwarn ────────────────────────────────────────────────────────────────
cast({
  pattern: 'resetwarn', alias: ['clearwarn'],
  desc: 'Reset warnings for a user (mention or reply)',
  category: 'moderation', filename: __filename,
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, reply }) => {
  if (!isGroup)              return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('⚠️ Admins only.');
  const target =
    (m.mentionedJid && m.mentionedJid[0]) ||
    (m.quoted && m.quoted.sender)         || null;
  if (!target) return reply('❗ Mention a user or reply to their message.');
  botdb.resetWarning(from, target);
  return reply(`✅ Warnings cleared for @${target.split('@')[0]}`);
});

// ── warnings ─────────────────────────────────────────────────────────────────
cast({
  pattern: 'warnings', alias: ['warnlist', 'warned'],
  desc: 'List warned users in this group',
  category: 'moderation', filename: __filename,
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, reply }) => {
  if (!isGroup)              return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('⚠️ Admins only.');
  const rows  = botdb.listWarnings(from);
  const limit = (botdb.getGroupSettings(from) || {}).warn_limit || 3;
  if (!rows.length) return reply('📭 No warnings recorded in this group.');
  const lines = rows.map((r,i) => `${i+1}. @${r.user_jid.split('@')[0]} — *${r.count}/${limit}*`);
  return reply(`⚠️ *Warnings (${rows.length}):*\n${lines.join('\n')}`);
});

// ── blacklist ─────────────────────────────────────────────────────────────────
cast({
  pattern: 'blacklist', alias: ['bl'],
  desc: 'Blacklist a user (mention, reply, or number)',
  category: 'moderation', filename: __filename,
}, async (conn, mek, m, { from, isOwner, isAdmins, args, reply }) => {
  if (!isOwner && !isAdmins) return reply('⛔ Admins only.');
  const target =
    (m.mentionedJid && m.mentionedJid[0]) ||
    (m.quoted && m.quoted.sender)         ||
    (args[0] && args[0].replace(/\D/g,'') + '@s.whatsapp.net') || null;
  if (!target) return reply('❗ Mention, reply, or provide a number.');
  botdb.addToBlacklist(target, 'manual');
  return reply(`🚫 *${target.split('@')[0]}* blacklisted.`);
});

// ── unblacklist ───────────────────────────────────────────────────────────────
cast({
  pattern: 'unblacklist', alias: ['unbl', 'removebl'],
  desc: 'Remove a user from the blacklist',
  category: 'moderation', filename: __filename,
}, async (conn, mek, m, { from, isOwner, isAdmins, args, reply }) => {
  if (!isOwner && !isAdmins) return reply('⛔ Admins only.');
  const target =
    (m.mentionedJid && m.mentionedJid[0]) ||
    (m.quoted && m.quoted.sender)         ||
    (args[0] && args[0].replace(/\D/g,'') + '@s.whatsapp.net') || null;
  if (!target) return reply('❗ Mention, reply, or provide a number.');
  botdb.removeFromBlacklist(target);
  return reply(`✅ *${target.split('@')[0]}* removed from blacklist.`);
});

// ── blacklisted ───────────────────────────────────────────────────────────────
cast({
  pattern: 'blacklisted', alias: ['bllist'],
  desc: 'Show all blacklisted users',
  category: 'moderation', filename: __filename,
}, async (conn, mek, m, { from, isOwner, reply }) => {
  if (!isOwner) return reply('⛔ Owner only.');
  const rows = botdb.getBlacklist();
  if (!rows.length) return reply('📭 No blacklisted users.');
  const lines = rows.map((r,i) => `${i+1}. @${r.user_jid.split('@')[0]}${r.reason ? ` — ${r.reason}` : ''}`);
  return reply(`🚫 *Blacklisted (${rows.length}):*\n${lines.join('\n')}`);
});

// ── DELSPAM ───────────────────────────────────────────────────────────────────
cast({
  pattern:  'delspam',
  alias:    ['dlspam'],
  desc:     'Delete last N messages of a replied/mentioned user from the group',
  category: 'moderation',
  use:      '<count> (reply or @mention user)',
  filename: __filename,
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, args, reply }) => {
  if (!isGroup)              return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('⚠️ Admins only.');

  // Resolve target: quoted sender OR first @mention
  const mentionedJid =
    mek.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
    mek.message?.imageMessage?.contextInfo?.mentionedJid || [];
  const ctx    = mek.message?.extendedTextMessage?.contextInfo;
  const target = ctx?.participant || m.quoted?.sender || mentionedJid?.[0] || null;
  if (!target) return reply('❗ Reply to a message or @mention a user.\n*Example:* delspam 10 @user');

  const limit = Math.min(parseInt(args?.[0]) || 0, 50);
  if (!limit) return reply('❗ Specify how many messages to delete (max 50).\n*Example:* delspam 10 @user');

  const targetNum = target.split('@')[0];

  // Pull from local message store
  let store;
  try { store = require('../index').store; } catch {}
  const chatMsgs = store?.messages?.[from];
  if (!chatMsgs || !Object.keys(chatMsgs).length)
    return reply('📭 No stored messages for this chat yet.\n_Messages are cached after the bot sees them._');

  const userMsgs = Object.values(chatMsgs)
    .filter(msg => (msg?.key?.participant || msg?.key?.remoteJid || '').includes(targetNum))
    .sort((a, b) => (b.messageTimestamp || 0) - (a.messageTimestamp || 0))
    .slice(0, limit);

  if (!userMsgs.length)
    return reply(`📭 No recent messages found from @${targetNum}`);

  await conn.sendMessage(from, {
    text: `⏳ Deleting *${userMsgs.length}* message(s) from @${targetNum}...`,
    mentions: [target]
  }, { quoted: mek });

  let deleted = 0;
  for (const msg of userMsgs) {
    try { await conn.sendMessage(from, { delete: msg.key }); deleted++; } catch {}
    await new Promise(r => setTimeout(r, 350));
  }

  await conn.sendMessage(from, {
    text: `✅ Deleted *${deleted}/${userMsgs.length}* messages from @${targetNum}.`,
    mentions: [target]
  }, { quoted: mek });
});

// ── ANTILINK ──────────────────────────────────────────────────────────────────
const { enableLinkDetection, disableLinkDetection, getLinkDetectionMode } = require('../lib/linkDetection');

cast({
  pattern:  'antilink',
  desc:     'Manage anti-link for this group. Modes: kick | delete | warn | off',
  category: 'moderation',
  filename: __filename,
}, async (conn, mek, m, { from, args, isGroup, isAdmins, isOwner, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');

  // Fallback admin check in case isAdmins wasn't resolved
  let admin = isAdmins || isOwner;
  if (!admin) {
    try {
      const meta    = await conn.groupMetadata(from);
      const sndNum  = (mek?.key?.participant || '').split('@')[0].split(':')[0];
      admin = meta.participants.some(p =>
        p.admin && (p.id || '').split('@')[0].split(':')[0] === sndNum
      );
    } catch {}
  }
  if (!admin) return reply('⚠️ Admins only.');

  const mode = (args[0] || '').toLowerCase();

  if (!mode) {
    const cur = getLinkDetectionMode(from);
    return reply(
      `🔗 *Antilink* — current mode: *${cur || 'off'}*\n\n` +
      `*Usage:* antilink <mode>\n` +
      `  *kick*   — remove member who sends link\n` +
      `  *delete* — delete the link only\n` +
      `  *warn*   — warn member (uses setwarnlimit)\n` +
      `  *off*    — disable antilink`
    );
  }

  if (!['kick','delete','warn','off'].includes(mode))
    return reply('❗ Valid modes: kick | delete | warn | off');

  if (mode === 'off') {
    disableLinkDetection(from);
    return reply('✅ Antilink *disabled* for this group.');
  }

  enableLinkDetection(from, mode);
  return reply(`✅ Antilink set to *${mode}* mode.`);
});

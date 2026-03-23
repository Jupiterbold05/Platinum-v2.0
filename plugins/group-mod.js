'use strict';

const { cast, makeSmartQuote, applyFont } = require('../cast');
const config = require('../config');
const botdb = require('../lib/botdb');

const fs   = require('fs');
const path = require('path');
const { getFeature, setFeature, setFeatureMode, getGroupSettings,
        incrementFeatureWarn, resetFeatureWarn, getFeatureWarn } = require('../lib/botdb');
const { lidToPhone } = require('../lib/lid');

// ── ANTI GROUP MENTION ────────────────────────────────
// cast + botdb imported at top

const FEATURE   = 'antigroupmention';

// ── Toggle command ────────────────────────────────────────────────────────────
cast({
  pattern: 'antigroupmention',
  desc: 'Enable/Disable anti group status mention',
  category: 'group',
  filename: __filename,
}, async (conn, mek, m, { from, args, isGroup, isAdmins, isOwner, reply }) => {
  if (!isGroup) return reply('❌ Groups only.');
  if (!isAdmins && !isOwner) return reply('❌ Admins only.');

  const f = getFeature(from, FEATURE);

  if (!args[0]) {
    return reply(`🔘 AntiGroupMention is *${f.enabled ? 'ON' : 'OFF'}*`);
  }

  const opt = args[0].toLowerCase();
  if (opt === 'on') {
    setFeature(from, FEATURE, true, '');
    return reply('✅ AntiGroupMention enabled.');
  }
  if (opt === 'off') {
    setFeature(from, FEATURE, false, '');
    return reply('❌ AntiGroupMention disabled.');
  }
  return reply('Use: antigroupmention on/off');
});

// ── Handler (called from index.js per-message) ────────────────────────────────
async function handleAntiGroupMention(conn, mek, context) {
  const { from, sender, isGroup, isAdmins, isOwner, isBotAdmins } = context;
  if (!isGroup) return;

  const f = getFeature(from, FEATURE);
  if (!f.enabled) return;
  if (!mek.message) return;
  if (isAdmins || isOwner) return;

  // Detect group status mention
  const isGroupStatusMention =
    !!mek.message.groupStatusMentionMessage ||
    (mek.message.protocolMessage && mek.message.protocolMessage.type === 25);

  if (!isGroupStatusMention) return;

  try {
    await conn.sendMessage(from, { delete: mek.key }).catch(() => {});

    const settings  = getGroupSettings(from);
    const warnLimit = settings.warn_limit || 3;
    const count     = incrementFeatureWarn(from, FEATURE, sender);

    await conn.sendMessage(from, {
      text: `⚠️ @${sender.split('@')[0]} warned for group status mention.\nWarning: ${count}/${warnLimit}`,
      mentions: [sender]
    }, { quoted: mek }).catch(() => {});

    if (count >= warnLimit) {
      if (isBotAdmins) {
        await conn.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
        await conn.sendMessage(from, {
          text: `🚫 @${sender.split('@')[0]} removed after ${warnLimit} warnings.`,
          mentions: [sender]
        }, { quoted: mek }).catch(() => {});
      } else {
        await conn.sendMessage(from, { text: '⚠️ I need admin rights to remove users.' }, { quoted: mek }).catch(() => {});
      }
      resetFeatureWarn(from, FEATURE, sender);
    }
  } catch (err) {
    console.error('AntiGroupMention error:', err);
  }
}



// ── ANTI NEWSLETTER ───────────────────────────────────

const FEATURE_1 = 'antinewsletter';

// ── Setup (called from index.js after conn is open) ───────────────────────────
function registerAntiNewsletter(conn) {
  // No separate listener needed — handled via handleAntiNewsletter below
}

// ── Per-message handler (called from index.js messages.upsert) ───────────────
async function handleAntiNewsletter(conn, mek, { from, sender, groupMetadata, groupAdmins } = {}) {
  if (!from || !from.endsWith('@g.us')) return;

  const f = getFeature(from, FEATURE);
  if (!f.enabled || !f.mode || f.mode === 'off') return;

  // Detect newsletter / channel forward
  const isNewsletter =
    mek.message?.newsletterAdminInviteMessage ||
    mek.message?.listMessage?.listType === 2 ||
    (mek.key?.remoteJid?.includes('@newsletter')) ||
    (mek.message?.extendedTextMessage?.contextInfo?.remoteJid?.includes('@newsletter'));

  if (!isNewsletter) return;

  const isAdmin = Array.isArray(groupAdmins) && groupAdmins.some(a =>
    String(a).split(':')[0].split('@')[0] === String(sender).split(':')[0].split('@')[0]
  );
  if (isAdmin) return;

  try {
    await conn.sendMessage(from, { delete: mek.key }).catch(() => {});

    const mode      = f.mode;
    const settings  = getGroupSettings(from);
    const warnLimit = settings.warn_limit || 3;

    if (mode === 'delete') {
      // already deleted
    } else if (mode === 'warn') {
      const count = incrementFeatureWarn(from, FEATURE, sender);
      await conn.sendMessage(from, {
        text: `⚠️ @${sender.split('@')[0]} — No newsletter forwards allowed!\nWarning: ${count}/${warnLimit}`,
        mentions: [sender]
      }).catch(() => {});
      if (count >= warnLimit) {
        await conn.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
        await conn.sendMessage(from, {
          text: `👢 @${sender.split('@')[0]} removed for repeated newsletter forwards.`,
          mentions: [sender]
        }).catch(() => {});
        resetFeatureWarn(from, FEATURE, sender);
      }
    } else if (mode === 'kick') {
      await conn.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
      await conn.sendMessage(from, {
        text: `👢 @${sender.split('@')[0]} removed for forwarding newsletter content.`,
        mentions: [sender]
      }).catch(() => {});
    }
  } catch (err) {
    console.error('antinewsletter error:', err);
  }
}

// ── Command ───────────────────────────────────────────────────────────────────
cast({
  pattern: 'antinewsletter',
  desc: 'Configure anti-newsletter mode: delete | warn | kick | off',
  category: 'group',
  filename: __filename,
}, async (conn, mek, m, { from, args, reply, isGroup, isAdmins, isOwner }) => {
  if (!isGroup)  return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('⚠️ Admins only.');

  const f = getFeature(from, FEATURE);
  if (!args[0]) return reply(`Current anti-newsletter mode: *${f.mode || 'off'}*`);

  const mode = args[0].toLowerCase();
  if (!['delete','warn','kick','off'].includes(mode))
    return reply('Options: delete | warn | kick | off');

  setFeatureMode(from, FEATURE, mode);
  return reply(`✅ Anti-newsletter set to: *${mode}*`);
});



// ── GROUP MESSAGES — antipromote/antidemote ───────────
// Welcome & goodbye settings now stored in unified SQLite via lib/botdb.js

function getParticipantId(p) {
  if (!p) return 'unknown';
  if (typeof p === 'string')             return p.split('@')[0];
  if (typeof p === 'object' && p.id)     return p.id.split('@')[0];
  return 'unknown';
}

// ── Strip ALL formatting from a JID to pure digits for comparison ─────
// Handles: "27751014718:5@s.whatsapp.net", "27751014718@lid", plain digits
function toDigits(jid) {
  if (!jid) return '';
  return String(jid).split(':')[0].split('@')[0].replace(/\D/g, '');
}

function registerGroupMessages(conn) {

  // ── Cooldown set: tracks JIDs the bot just acted on ────────────────
  // Key: `${groupId}|${jid}|${action}` — expires after 8 seconds
  // This prevents the bot's own promote/demote from triggering the handler
  const botActed = new Set();
  function markBotAction(groupId, jid, action) {
    const key = `${groupId}|${toDigits(jid)}|${action}`;
    botActed.add(key);
    setTimeout(() => botActed.delete(key), 8000);
  }
  function isBotCooldown(groupId, jid, action) {
    return botActed.has(`${groupId}|${toDigits(jid)}|${action}`);
  }

  conn.ev.on('group-participants.update', async (update) => {
    const { id: groupId, action, participants, author } = update;
    if (!groupId || !participants?.length) return;

    // ── Get bot number (digits only, no suffix) ───────────────────────
    const botDigits    = toDigits(conn.user?.id || '');
    const authorDigits = toDigits(author || '');

    // ── Is this event caused by the bot itself? ───────────────────────
    // Check 1: author JID matches bot number
    // Check 2: cooldown set (catches race conditions where author JID is missing)
    const isBotAuthor = botDigits && authorDigits && authorDigits === botDigits;

    let groupName = groupId;
    try {
      const meta = await conn.groupMetadata(groupId);
      groupName = meta?.subject || groupId;
    } catch (_) {}

    const now = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos' });

    // ── Welcome ───────────────────────────────────────────────────────
    if (action === 'add') {
      const settings = botdb.getGreetings(groupId);
      if (settings.welcome_enabled) {
        const tpl = settings.welcome_msg || "Welcome @{user} to {group}! We're glad to have you 🎉";
        for (const participant of participants) {
          const userNum = getParticipantId(participant);
          const msg = tpl
            .replace(/@\{user\}|\{user\}/gi, `@${userNum}`)
            .replace(/\{group\}/gi, groupName);
          let dp = 'https://files.catbox.moe/49gzva.png';
          try { dp = await conn.profilePictureUrl(participant, 'image'); } catch (_) {}
          await conn.sendMessage(groupId, {
            image: { url: dp }, caption: msg, mentions: [participant]
          }).catch(() =>
            conn.sendMessage(groupId, { text: msg, mentions: [participant] }, { quoted: mek })
          );
        }
      }
    }

    // ── Goodbye ───────────────────────────────────────────────────────
    if (action === 'remove') {
      const settings = botdb.getGreetings(groupId);
      if (settings.goodbye_enabled) {
        const tpl = settings.goodbye_msg || "Goodbye @{user} from {group}. We'll miss you! 👋";
        for (const participant of participants) {
          const userNum = getParticipantId(participant);
          const msg = tpl
            .replace(/@\{user\}|\{user\}/gi, `@${userNum}`)
            .replace(/\{group\}/gi, groupName);
          let dp = 'https://files.catbox.moe/49gzva.png';
          try { dp = await conn.profilePictureUrl(participant, 'image'); } catch (_) {}
          await conn.sendMessage(groupId, {
            image: { url: dp }, caption: msg, mentions: [participant]
          }).catch(() =>
            conn.sendMessage(groupId, { text: msg, mentions: [participant] }, { quoted: mek })
          );
        }
      }
    }

    // ── Anti-Promote ──────────────────────────────────────────────────
    if (action === 'promote') {
      // Skip entirely if the bot triggered this event
      const participantDigits = toDigits(
        typeof participants[0] === 'string' ? participants[0] : participants[0]?.id
      );
      if (isBotAuthor || isBotCooldown(groupId, participantDigits, 'promote')) {
        // Bot's own promotion — just show announcement, no reversal
      } else {
        const feat = getFeature(groupId, 'antipromote');
        if (feat && feat.enabled) {
          for (const participant of participants) {
            const participantJid = typeof participant === 'string' ? participant : participant.id;
            const actorNum  = authorDigits;
            const targetNum = toDigits(participantJid);

            // Mark cooldowns BEFORE acting so echoed events are caught
            markBotAction(groupId, participantJid, 'demote'); // bot will demote participant
            if (author) markBotAction(groupId, author, 'demote'); // bot will demote actor

            try { await conn.groupParticipantsUpdate(groupId, [participantJid], 'demote'); } catch {}
            if (author) {
              try { await conn.groupParticipantsUpdate(groupId, [author], 'demote'); } catch {}
            }

            await conn.sendMessage(groupId, {
              text:
                `🚫 *Anti-Promote Active*\n\n` +
                `@${actorNum} tried to promote @${targetNum}.\n\n` +
                `• @${targetNum} has been *demoted back*.\n` +
                `• @${actorNum} has been *demoted* as punishment.`,
              mentions: [author, participantJid].filter(Boolean)
            }, { quoted: mek }).catch(() => {});
          }
          return; // skip promotion announcement
        }
      }
    }

    // ── Promote announcement ──────────────────────────────────────────
    if (action === 'promote') {
      const celebrationMsgs = [
        "New admin in the house! 🎉", "The throne has a new ruler! 👑",
        "Power upgrade complete! ⚡", "A new sheriff in town! 🤠",
        "Leadership level unlocked! 🏅", "Admin powers activated! 💫"
      ];
      const actorTag = author ? `@${getParticipantId(author)}` : 'system';
      for (const participant of participants) {
        const userTag = `@${getParticipantId(participant)}`;
        const msg = `╔════════════════════╗\n║  🎖️ 𝗣𝗥𝗢𝗠𝗢𝗧𝗜𝗢𝗡  🎖️  ║\n╠════════════════════╣\n║ 𝗨𝘀𝗲𝗿: ${userTag}\n║ 𝗕𝘆:   ${actorTag}\n║ 𝗧𝗶𝗺𝗲: ${now}\n╚════════════════════╝\n${celebrationMsgs[Math.floor(Math.random() * celebrationMsgs.length)]}`;
        await conn.sendMessage(groupId, {
          text: msg, mentions: [participant, ...(author ? [author] : [])]
        }, { quoted: mek }).catch(() => {});
      }
    }

    // ── Anti-Demote ───────────────────────────────────────────────────
    if (action === 'demote') {
      const participantDigits = toDigits(
        typeof participants[0] === 'string' ? participants[0] : participants[0]?.id
      );
      if (isBotAuthor || isBotCooldown(groupId, participantDigits, 'demote')) {
        // Bot's own demotion — just show announcement, no reversal
      } else {
        const feat = getFeature(groupId, 'antidemote');
        if (feat && feat.enabled) {
          for (const participant of participants) {
            const participantJid = typeof participant === 'string' ? participant : participant.id;
            const actorNum  = authorDigits;
            const targetNum = toDigits(participantJid);

            // Mark cooldowns BEFORE acting
            markBotAction(groupId, participantJid, 'promote'); // bot will promote participant back
            if (author) markBotAction(groupId, author, 'demote'); // bot will demote actor

            try { await conn.groupParticipantsUpdate(groupId, [participantJid], 'promote'); } catch {}
            if (author) {
              try { await conn.groupParticipantsUpdate(groupId, [author], 'demote'); } catch {}
            }

            await conn.sendMessage(groupId, {
              text:
                `🚫 *Anti-Demote Active*\n\n` +
                `@${actorNum} tried to demote @${targetNum}.\n\n` +
                `• @${targetNum} has been *re-promoted*.\n` +
                `• @${actorNum} has been *demoted* as punishment.`,
              mentions: [author, participantJid].filter(Boolean)
            }, { quoted: mek }).catch(() => {});
          }
          return; // skip demotion announcement
        }
      }
    }

    // ── Demote announcement ───────────────────────────────────────────
    if (action === 'demote') {
      const sympathyMsgs = [
        "The crown has been removed... 👑➡️🧢", "Admin powers revoked! ⚡➡️💤",
        "Back to civilian life! 🎖️➡️👕", "Admin status: REVOKED ❌"
      ];
      const actorTag = author ? `@${getParticipantId(author)}` : 'system';
      for (const participant of participants) {
        const userTag = `@${getParticipantId(participant)}`;
        const msg = `╔════════════════════╗\n║  ⚠️ 𝗗𝗘𝗠𝗢𝗧𝗜𝗢𝗡  ⚠️  ║\n╠════════════════════╣\n║ 𝗨𝘀𝗲𝗿: ${userTag}\n║ 𝗕𝘆:   ${actorTag}\n║ 𝗧𝗶𝗺𝗲: ${now}\n╚════════════════════╝\n${sympathyMsgs[Math.floor(Math.random() * sympathyMsgs.length)]}`;
        await conn.sendMessage(groupId, {
          text: msg, mentions: [participant, ...(author ? [author] : [])]
        }, { quoted: mek }).catch(() => {});
      }
    }
  });
}

// ── Toggle commands ───────────────────────────────────────────────────────────

cast({
  pattern: 'antipromote',
  desc: 'Prevent unauthorized promotions — reverses the action automatically',
  category: 'group',
  filename: __filename,
}, async (conn, mek, m, { from, args, reply, isGroup, isAdmins, isOwner }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('🚫 Admins only.');

  const opt     = (args[0] || '').toLowerCase();
  const feat    = getFeature(from, 'antipromote');
  const current = feat && feat.enabled;

  if (!opt) {
    return reply(
      `🛡️ *Anti-Promote*\n\n` +
      `Status: *${current ? 'ON ✅' : 'OFF ❌'}*\n\n` +
      `Usage:\n• /antipromote on\n• /antipromote off`
    );
  }
  if (opt === 'on')  { setFeature(from, 'antipromote', 1); return reply('✅ *Anti-Promote enabled.*\nAny unauthorized promotion will be automatically reversed.'); }
  if (opt === 'off') { setFeature(from, 'antipromote', 0); return reply('❌ *Anti-Promote disabled.*'); }
  return reply('Usage: /antipromote on | off');
});

cast({
  pattern: 'antidemote',
  desc: 'Prevent unauthorized demotions — reverses the action automatically',
  category: 'group',
  filename: __filename,
}, async (conn, mek, m, { from, args, reply, isGroup, isAdmins, isOwner }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('🚫 Admins only.');

  const opt     = (args[0] || '').toLowerCase();
  const feat    = getFeature(from, 'antidemote');
  const current = feat && feat.enabled;

  if (!opt) {
    return reply(
      `🛡️ *Anti-Demote*\n\n` +
      `Status: *${current ? 'ON ✅' : 'OFF ❌'}*\n\n` +
      `Usage:\n• /antidemote on\n• /antidemote off`
    );
  }
  if (opt === 'on')  { setFeature(from, 'antidemote', 1); return reply('✅ *Anti-Demote enabled.*\nAny unauthorized demotion will be automatically reversed.'); }
  if (opt === 'off') { setFeature(from, 'antidemote', 0); return reply('❌ *Anti-Demote disabled.*'); }
  return reply('Usage: /antidemote on | off');
});



// ── WELCOME/GOODBYE — setwelcome/setgoodbye ───────────
// Toggle commands for welcome/goodbye using NEXUS-MD botdb (getGreetings/setWelcome/setGoodbye)

// ── setwelcome ────────────────────────────────────────────────────────
cast({
  pattern:  'setwelcome',
  alias:    ['welcome'],
  desc:     'Set welcome message or toggle on/off. Vars: @{user} {group} {count}',
  category: 'group',
  react:    '👋',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, q, groupName, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('❌ Admins only.');

  if (!q) {
    const s = botdb.getGreetings(from);
    return reply(
      `👋 *Welcome Status*\n` +
      `Status: ${s.welcome_enabled ? '✅ ON' : '❌ OFF'}\n` +
      (s.welcome_msg ? `Message: ${s.welcome_msg}\n` : '') +
      `\n*Usage:*\n` +
      `setwelcome on  — enable with current/default message\n` +
      `setwelcome off — disable\n` +
      `setwelcome Welcome @{user} to {group}! — set message & enable\n` +
      `\n*Variables:* @{user}  {group}  {count}`
    );
  }

  const opt = q.toLowerCase().trim();

  if (opt === 'off') {
    botdb.setWelcome(from, false, botdb.getGreetings(from).welcome_msg || '');
    return reply('❌ Welcome message *disabled*.');
  }

  if (opt === 'on') {
    const cur = botdb.getGreetings(from);
    botdb.setWelcome(from, true, cur.welcome_msg || 'Welcome @{user} to *{group}*! 🎉');
    return reply('✅ Welcome message *enabled*.');
  }

  // Set custom message AND enable
  botdb.setWelcome(from, true, q);
  const preview = q
    .replace(/@\{user\}|\{user\}/gi, '@NewMember')
    .replace(/\{group\}/gi, groupName || 'Group')
    .replace(/\{count\}/gi, '25');
  return reply(`✅ *Welcome ON + message set!*\n\n*Preview:*\n${preview}`);
});

// ── setgoodbye ────────────────────────────────────────────────────────
cast({
  pattern:  'setgoodbye',
  alias:    ['goodbye', 'setbye'],
  desc:     'Set goodbye message or toggle on/off. Vars: @{user} {group} {count}',
  category: 'group',
  react:    '🚪',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, q, groupName, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('❌ Admins only.');

  if (!q) {
    const s = botdb.getGreetings(from);
    return reply(
      `🚪 *Goodbye Status*\n` +
      `Status: ${s.goodbye_enabled ? '✅ ON' : '❌ OFF'}\n` +
      (s.goodbye_msg ? `Message: ${s.goodbye_msg}\n` : '') +
      `\n*Usage:*\n` +
      `setgoodbye on  — enable\n` +
      `setgoodbye off — disable\n` +
      `setgoodbye Goodbye @{user} from {group}! — set message & enable\n` +
      `\n*Variables:* @{user}  {group}  {count}`
    );
  }

  const opt = q.toLowerCase().trim();

  if (opt === 'off') {
    botdb.setGoodbye(from, false, botdb.getGreetings(from).goodbye_msg || '');
    return reply('❌ Goodbye message *disabled*.');
  }

  if (opt === 'on') {
    const cur = botdb.getGreetings(from);
    botdb.setGoodbye(from, true, cur.goodbye_msg || `Goodbye @{user}! 👋 We'll miss you in *{group}*.`);
    return reply('✅ Goodbye message *enabled*.');
  }

  botdb.setGoodbye(from, true, q);
  const preview = q
    .replace(/@\{user\}|\{user\}/gi, '@LeavingMember')
    .replace(/\{group\}/gi, groupName || 'Group')
    .replace(/\{count\}/gi, '24');
  return reply(`✅ *Goodbye ON + message set!*\n\n*Preview:*\n${preview}`);
});

// ── welcomestatus ─────────────────────────────────────────────────────
cast({
  pattern:  'welcomestatus',
  alias:    ['greetingstatus'],
  desc:     'Check welcome/goodbye settings for this group',
  category: 'group',
  react:    '⚙️',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  const s = botdb.getGreetings(from);
  await conn.sendMessage(from, {
    text:
      `⚙️ *Welcome/Goodbye Status*\n\n` +
      `👋 Welcome: ${s.welcome_enabled ? '✅ ON' : '❌ OFF'}\n` +
      (s.welcome_msg ? `   _"${s.welcome_msg.substring(0, 80)}${s.welcome_msg.length > 80 ? '...' : ''}"_\n` : '') +
      `🚪 Goodbye: ${s.goodbye_enabled ? '✅ ON' : '❌ OFF'}\n` +
      (s.goodbye_msg ? `   _"${s.goodbye_msg.substring(0, 80)}${s.goodbye_msg.length > 80 ? '...' : ''}"_\n` : '') +
      `\n_Vars: @{user} @{group}_`
  }, { quoted: mek });
});

// ── KEYWORD FILTERS — addfilter/removefilter/listfilters 
// Keyword auto-reply per group, with persistent JSON storage

// Filters use botdb (no JSON files)
function readF(gJid)     { return Object.fromEntries(botdb.getFilters(gJid).map(r=>[r.keyword,r.response])); }
function saveF()         { /* botdb handles persistence */ }
function _addF(g,k,r)    { botdb.addFilter(g,k,r); }
function _delF(g,k)      { return botdb.removeFilter(g,k); }
function _clearF(g)      { return botdb.clearFilters(g); }

// ── addfilter ─────────────────────────────────────────────────────────
cast({
  pattern:  'addfilter',
  alias:    ['filter'],
  desc:     'Add keyword auto-reply: addfilter <keyword> | <response>',
  category: 'group',
  react:    '🔑',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, body, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('❌ Admins only.');

  const text = (body || '').split(' ').slice(1).join(' ');
  const sep  = text.indexOf('|');
  if (sep === -1) return reply('❗ Usage: addfilter <keyword> | <response>');
  const keyword  = text.slice(0, sep).trim().toLowerCase();
  const response = text.slice(sep + 1).trim();
  if (!keyword || !response) return reply('❗ Both keyword and response are required.');

  _addF(from, keyword, response);
  reply(`✅ Filter added!\n🔑 *Keyword:* ${keyword}\n💬 *Response:* ${response.substring(0, 100)}`);
});

// ── removefilter ──────────────────────────────────────────────────────
cast({
  pattern:  'removefilter',
  alias:    ['delfilter'],
  desc:     'Remove a keyword filter: removefilter <keyword>',
  category: 'group',
  react:    '🗑️',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, body, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('❌ Admins only.');
  const keyword = (body || '').split(' ').slice(1).join(' ').trim().toLowerCase();
  if (!keyword) return reply('❗ Usage: removefilter <keyword>');
  const data = readF();
  if (!data[from]?.[keyword]) return reply(`❌ No filter for keyword: *${keyword}*`);
  delete data[from][keyword];
  saveF(data);
  reply(`✅ Filter *${keyword}* removed.`);
});

// ── listfilters ───────────────────────────────────────────────────────
cast({
  pattern:  'listfilters',
  alias:    ['filters'],
  desc:     'List all keyword filters in this group',
  category: 'group',
  react:    '📋',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  const data    = readF();
  const filters = data[from] || {};
  const keys    = Object.keys(filters);
  if (!keys.length) return reply('📭 No filters set.\nAdd one: *addfilter <keyword> | <response>*');
  const lines = keys.map((k, i) =>
    `${i + 1}. 🔑 *${k}*\n   → ${filters[k].substring(0, 80)}${filters[k].length > 80 ? '...' : ''}`
  );
  await conn.sendMessage(from, {
    text: `🔍 *Filters (${keys.length})*\n\n${lines.join('\n\n')}`
  }, { quoted: mek });
});

// ── clearfilters ──────────────────────────────────────────────────────
cast({
  pattern:  'clearfilters',
  desc:     'Remove ALL keyword filters in this group (admin only)',
  category: 'group',
  react:    '🗑️',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('❌ Admins only.');
  const data  = readF();
  const count = Object.keys(data[from] || {}).length;
  if (!count) return reply('📭 No filters to clear.');
  delete data[from];
  saveF(data);
  reply(`🗑️ Cleared *${count}* filter${count > 1 ? 's' : ''}.`);
});

// ── LISTENER — registered from index.js ──────────────────────────────
function registerFilterListener(conn) {
  conn.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const mek of messages) {
      try {
        if (!mek.message || mek.key.fromMe) continue;
        const from = mek.key.remoteJid;
        if (!from?.endsWith('@g.us')) continue;
        const data    = readF();
        const filters = data[from];
        if (!filters || !Object.keys(filters).length) continue;
        const text = (
          mek.message?.conversation ||
          mek.message?.extendedTextMessage?.text ||
          mek.message?.imageMessage?.caption ||
          mek.message?.videoMessage?.caption || ''
        ).toLowerCase().trim();
        if (!text) continue;
        for (const [keyword, response] of Object.entries(filters)) {
          if (text.includes(keyword)) {
            await conn.sendMessage(from, { text: response }, { quoted: mek }).catch(() => {});
            break;
          }
        }
      } catch (e) { console.error('filter listener:', e.message); }
    }
  });
  console.log('✅ Filter listener registered.');
}



// ── GROUP NOTES — savenote/getnote/listnotes/delnote ──
// Per-group saved notes with persistent JSON storage

const NOTES_FILE = path.join(__dirname, '../lib/notes.json');
function readN()  { try { return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8')); } catch { return {}; } }
function saveN(d) { fs.writeFileSync(NOTES_FILE, JSON.stringify(d, null, 2)); }
if (!fs.existsSync(NOTES_FILE)) saveN({});

// ── savenote ──────────────────────────────────────────────────────────
cast({
  pattern:  'savenote',
  alias:    ['note', 'addnote'],
  desc:     'Save a note: savenote <name> | <content>',
  category: 'group',
  react:    '📝',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, body, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  const text = (body || '').split(' ').slice(1).join(' ');
  const sep  = text.indexOf('|');
  if (sep === -1) return reply('❗ Usage: savenote <name> | <content>\nExample: savenote rules | Be respectful, no spam.');
  const name    = text.slice(0, sep).trim().toLowerCase().replace(/\s+/g, '_');
  const content = text.slice(sep + 1).trim();
  if (!name || !content) return reply('❗ Both a name and content are required.');
  const notes = readN();
  if (!notes[from]) notes[from] = {};
  notes[from][name] = { content, savedAt: Date.now() };
  saveN(notes);
  reply(`📝 Note *${name}* saved!\nGet it with: *getnote ${name}*`);
});

// ── getnote ───────────────────────────────────────────────────────────
cast({
  pattern:  'getnote',
  alias:    ['#'],
  desc:     'Get a saved note: getnote <name>',
  category: 'group',
  react:    '📌',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, q, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  const name = (q || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!name) return reply('❗ Usage: getnote <name>\nSee all: *listnotes*');
  const notes = readN();
  const note  = notes[from]?.[name];
  if (!note) return reply(`❌ Note *${name}* not found.\nSee all with: *listnotes*`);
  const age = Math.floor((Date.now() - note.savedAt) / 86400000);
  await conn.sendMessage(from, {
    text: `📌 *${name}*\n\n${note.content}\n\n_Saved ${age === 0 ? 'today' : `${age} day${age > 1 ? 's' : ''} ago`}_`
  }, { quoted: mek });
});

// ── listnotes ─────────────────────────────────────────────────────────
cast({
  pattern:  'listnotes',
  alias:    ['notes', 'notelist'],
  desc:     'List all notes saved in this group',
  category: 'group',
  react:    '📒',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  const notes    = readN();
  const grpNotes = notes[from] || {};
  const keys     = Object.keys(grpNotes);
  if (!keys.length) return reply('📭 No notes saved yet.\nAdd one: *savenote <name> | <content>*');
  const lines = keys.map((k, i) => {
    const preview = grpNotes[k].content.substring(0, 60) + (grpNotes[k].content.length > 60 ? '...' : '');
    return `${i + 1}. 📌 *${k}*\n   ${preview}`;
  });
  await conn.sendMessage(from, {
    text: `📒 *Notes (${keys.length})*\n\n${lines.join('\n\n')}\n\n_Use *getnote <name>* to read_`
  }, { quoted: mek });
});

// ── delnote ───────────────────────────────────────────────────────────
cast({
  pattern:  'delnote',
  alias:    ['deletenote'],
  desc:     'Delete a note (admin): delnote <name>',
  category: 'group',
  react:    '🗑️',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, q, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('❌ Admins only.');
  const name = (q || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!name) return reply('❗ Usage: delnote <name>');
  const notes = readN();
  if (!notes[from]?.[name]) return reply(`❌ Note *${name}* not found.`);
  delete notes[from][name];
  saveN(notes);
  reply(`✅ Note *${name}* deleted.`);
});

// ── clearnotes ────────────────────────────────────────────────────────
cast({
  pattern:  'clearnotes',
  desc:     'Delete ALL notes in this group (admin only)',
  category: 'group',
  react:    '🗑️',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('❌ Admins only.');
  const notes = readN();
  const count = Object.keys(notes[from] || {}).length;
  if (!count) return reply('📭 No notes to clear.');
  delete notes[from];
  saveN(notes);
  reply(`🗑️ Cleared *${count}* note${count > 1 ? 's' : ''}.`);
});

module.exports = { handleAntiGroupMention, registerAntiNewsletter, handleAntiNewsletter, registerGroupMessages, registerFilterListener };

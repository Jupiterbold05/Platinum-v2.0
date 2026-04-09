// plugins/antibot.js — NEXUS-MD
'use strict';

const { cast }                         = require('../cast');
const { getFeature, setFeature,
        incrementFeatureWarn,
        resetFeatureWarn,
        getGroupSettings }             = require('../lib/botdb');
const config = require('../config');

const FEATURE = 'antibot';

// ── Bot detection ─────────────────────────────────────────────────────────────
// Only detects actual bot accounts — NOT command users or the bot itself
function isBotMessage(mek, botNumber, ownerNumbers = []) {
  const msgId  = (mek?.key?.id || '').toUpperCase();
  const sender = mek?.key?.participant || mek?.key?.remoteJid || '';
  const senderNum = sender.split('@')[0].split(':')[0];

  // Never flag the bot itself
  if (senderNum === botNumber) return false;

  // Never flag owner numbers
  if (ownerNumbers.some(o => String(o).replace(/\D/g,'') === senderNum)) return false;

  // Never flag if it looks like a command (starts with prefix)
  const prefix = config.PREFIX || ':';
  const body =
    mek?.message?.conversation ||
    mek?.message?.extendedTextMessage?.text ||
    mek?.message?.imageMessage?.caption ||
    mek?.message?.videoMessage?.caption || '';
  if (body.startsWith(prefix)) return false;

  // 1. Known bot message ID prefixes
  const botIdPrefixes = [
    '3EB0',   // Baileys default
    'BAE5',   // older Baileys
    'FALSE',  // WA-Multi-Device
    'TRUE',
    'NEXUS',  // self-referential but safe to flag others
    'XYLO',   // XYLO-MD
    'CYPHER', // Cypher-X
    'WBOT',   // WhisperBot
    'MBOT',
  ];
  if (botIdPrefixes.some(p => msgId.startsWith(p))) return true;

  // 2. Verified business / bot badge
  if (mek?.verifiedBizName) return true;

  // 3. All-uppercase hex, exactly 32 chars — common Baileys pattern
  if (/^[0-9A-F]{32}$/.test(msgId)) return true;

  // 4. No pushName + automated message types (not human-typed)
  const hasPushName = !!(mek?.pushName);
  const msg = mek?.message;
  if (!hasPushName && msg) {
    const isAutomated =
      !!msg.senderKeyDistributionMessage ||
      (!!msg.protocolMessage && msg.protocolMessage.type !== 10); // type 10 = read receipt, harmless
    if (isAutomated) return true;
  }

  return false;
}

async function handleAntiBot(conn, mek, { from, sender, groupAdmins, botNumber, ownerNumbers } = {}) {
  try {
    if (!from?.endsWith('@g.us')) return;

    // Skip the bot's own messages
    if (mek.key?.fromMe) return;

    const f = getFeature(from, FEATURE);
    if (!f.enabled || !f.mode || f.mode === 'off') return;

    const participant = sender || mek.key?.participant;
    if (!participant) return;

    // Skip reactions
    if (mek.message?.reactionMessage) return;

    // Issue 1: Skip group admins (including bot-admin bots)
    const participantDigits = participant.split('@')[0].split(':')[0].replace(/\D/g, '');
    const adminDigits = (groupAdmins || []).map(j =>
      j.split('@')[0].split(':')[0].replace(/\D/g, '')
    );
    if (adminDigits.includes(participantDigits)) return;

    // ── Handle edits (protocolMessage) ───────────────────────────────────
    if (mek.message?.protocolMessage) {
      const proto   = mek.message.protocolMessage;
      const origKey = proto.key;
      if ((proto.type === 14 || proto.editedMessage) && origKey) {
        const origId = (origKey.id || '').toUpperCase();
        const botIdPrefixes = ['3EB0', 'BAE5', 'FALSE', 'TRUE', 'XYLO', 'CYPHER'];
        if (botIdPrefixes.some(p => origId.startsWith(p))) {
          await conn.sendMessage(from, { delete: mek.key }).catch(() => {});
          await conn.sendMessage(from, { delete: origKey }).catch(() => {});
        }
      }
      return;
    }

    // Issue 2: Pass botNumber and ownerNumbers to isBotMessage so it can exclude them
    const _botNum = botNumber || conn?.user?.id?.split(':')[0] || '';
    if (!isBotMessage(mek, _botNum, ownerNumbers || [])) return;

    const mode      = f.mode;
    const settings  = getGroupSettings(from) || {};
    const warnLimit = settings.warn_limit || 3;
    const num       = participant.split('@')[0];

    if (mode === 'delete') {
      await conn.sendMessage(from, { delete: mek.key }).catch(() => {});
      await conn.sendMessage(from, {
        text: `🤖 @${num} — bot accounts are not allowed here.`,
        mentions: [participant]
      }).catch(() => {});

    } else if (mode === 'kick') {
      await conn.sendMessage(from, { delete: mek.key }).catch(() => {});
      await conn.groupParticipantsUpdate(from, [participant], 'remove').catch(() => {});
      await conn.sendMessage(from, {
        text: `🤖 @${num} — bot account removed.`,
        mentions: [participant]
      }).catch(() => {});

    } else if (mode === 'warn') {
      const count = incrementFeatureWarn(from, FEATURE, participant);
      await conn.sendMessage(from, { delete: mek.key }).catch(() => {});
      if (count >= warnLimit) {
        await conn.groupParticipantsUpdate(from, [participant], 'remove').catch(() => {});
        await conn.sendMessage(from, {
          text: `🤖 @${num} removed after ${count}/${warnLimit} warnings.`,
          mentions: [participant]
        }).catch(() => {});
        resetFeatureWarn(from, FEATURE, participant);
      } else {
        await conn.sendMessage(from, {
          text: `🤖 @${num} — warning *${count}/${warnLimit}*. Bot accounts not allowed.`,
          mentions: [participant]
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.error('[NEXUS-MD] antibot error:', e.message);
  }
}

// ── antibot command ───────────────────────────────────────────────────────────
cast({
  pattern:  'antibot',
  desc:     'Manage antibot. Modes: warn | kick | delete | off',
  category: 'moderation',
  filename: __filename,
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, args, reply }) => {
  if (!isGroup)              return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('⚠️ Admins only.');

  const mode = (args[0] || '').toLowerCase();

  if (!mode) {
    const f = getFeature(from, FEATURE);
    return reply(
      `🤖 *Antibot Status*\n` +
      `Status: ${f.enabled ? '✅ ON' : '❌ OFF'}\n` +
      `Mode: *${f.mode || 'off'}*\n\n` +
      `*Usage:* antibot <mode>\n` +
      `  *warn*   — warn bot accounts\n` +
      `  *kick*   — remove immediately\n` +
      `  *delete* — delete messages only\n` +
      `  *off*    — disable`
    );
  }

  if (!['warn','kick','delete','off'].includes(mode))
    return reply('❗ Valid modes: warn | kick | delete | off');

  if (mode === 'off') {
    setFeature(from, FEATURE, false, 'off');
    return reply('❌ Antibot *disabled*.');
  }

  setFeature(from, FEATURE, true, mode);
  return reply(`✅ Antibot set to *${mode}* mode.`);
});

module.exports = { handleAntiBot };

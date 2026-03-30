'use strict';

const { cast, makeSmartQuote, applyFont } = require('../cast');
const config = require('../config');
const botdb = require('../lib/botdb');
const fetch = require('node-fetch');
const axios = require('axios');

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { isSudo, addSudo, removeSudo, listSudo } = require('../lib/botdb');

// ── ANTI CALL ─────────────────────────────────────────
// In index.js, inside the 'connection open' block add:
//   const { registerAntiCall } = require('./plugins/anticall');
//   registerAntiCall(conn);

const ANTICALL_MSG =
  `Hello! This is *${config.BOT_NAME || 'NEXUS-MD'}*\n\n` +
  `Sorry, I cannot receive calls at this time.\n` +
  `Please send a text message instead. 👸`;

function loadSettings()        { return {}; } // botdb handles persistence
function saveSettings()        {}              // no-op — botdb handles it
function getMode(botNum)       { return botdb.getAntiCall(botNum); }
function setMode(botNum, mode) { botdb.setAntiCall(botNum, mode); }

const warnMap = {};

// ── ANTICALL command ──────────────────────────────────────────────────────────
cast({
  pattern: 'anticall',
  alias: ['callblock', 'blockcall'],
  desc: 'Configure anticall — block all calls or by country code',
  category: 'owner',
  use: '<all | 212,91 | off>',
  filename: __filename,
}, async (conn, mek, m, { from, q, botNumber, isOwner, reply }) => {
  if (!isOwner) return reply('🚫 Owner only.');

  const key = botNumber;
  const cur = getMode(key) || 'false';
  const arg = q ? q.toLowerCase().trim() : '';

  // Turn off
  if (arg === 'off' || arg === 'deact' || arg === 'disable') {
    if (cur === 'false') return reply('*AntiCall is already disabled!*');
    getMode(key) = 'false';
    saveSettings(settings);
    return reply('*✅ AntiCall disabled successfully!*');
  }

  // Show current status
  if (!arg) {
    const status = cur === 'false' ? 'Not set / Disabled' : `Active — blocking: *${cur}*`;
    return reply(`*AntiCall Status:* ${status}\n\n*Usage:*\n:anticall all → block all calls\n:anticall 212,91 → block by country code\n:anticall off → disable`);
  }

  // Set to all
  if (arg === 'all') {
    getMode(key) === 'all';
    saveSettings(settings);
    return reply('*✅ AntiCall set to block ALL calls!*');
  }

  // Set country codes
  const codes = arg.split(',').map(c => parseInt(c.trim())).filter(n => !isNaN(n));
  if (!codes.length) return reply('*❌ Invalid country codes.*\nExample: :anticall 212,91,231');
  getMode(key) === codes.join(',');
  saveSettings(settings);
  reply(`*✅ AntiCall set — blocking calls from country codes: ${getMode(key)}*`);
});

// ── registerAntiCall — hook call events ───────────────────────────────────────
function registerAntiCall(conn) {
  conn.ev.on('call', async (calls) => {
    for (const call of calls) {
      try {
        if (call.status !== 'offer') continue;

        const botNumber = conn.user.id.split(':')[0];
        const setting   = getMode(botNumber) || 'false';
        if (setting === 'false') continue;

        // Check if caller matches country code filter or setting is 'all'
        const caller = call.from || '';
        let shouldBlock = false;

        if (setting === 'all') {
          shouldBlock = true;
        } else {
          const codes = setting.split(',').map(c => c.trim());
          shouldBlock = codes.some(code => caller.startsWith(code));
        }

        if (!shouldBlock) continue;

        // Decline the call
        await conn.rejectCall(call.id, call.from);

        // Track warns
        if (!warnMap[caller]) warnMap[caller] = { warn: 0 };
        if (warnMap[caller].warn < 2) {
          await conn.sendMessage(caller, { text: ANTICALL_MSG }, { quoted: mek });
        }
        warnMap[caller].warn++;

        await conn.sendMessage(caller, {
          text: `*_${warnMap[caller].warn} Call rejected from @${caller.split('@')[0]}..!!_*`,
          mentions: [caller]
        }, { quoted: mek });

      } catch (e) {
        console.error('anticall error:', e.message);
      }
    }
  });
  console.log('✅ AntiCall listener registered');
}

// ── ANTI VIEW ONCE ────────────────────────────────────
// Hook: call registerAntiViewOnce(conn) in both index files on connection open

// ── botdb helpers (reuse group_settings table with a special key) ──────────
const KEY = 'antiviewonce';

function isEnabled(botNumber) {
  try {
    return botdb.kvGet('antiviewonce:' + botNumber, 'false') === 'true';
  } catch (e) { return false; }
}
function setEnabled(botNumber, val) {
  try {
    botdb.kvSet('antiviewonce:' + botNumber, val ? 'true' : 'false');
  } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// ANTIVIEWONCE command — owner only
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'antiviewonce',
  alias: ['antivv', 'avv'],
  desc: 'Turn on/off auto ViewOnce downloader',
  category: 'owner',
  use: '<on/off>',
  filename: __filename,
}, async (conn, mek, m, { from, q, botNumber, isOwner, reply }) => {
  if (!isOwner) return reply('🚫 Owner only.');

  const arg = q ? q.toLowerCase().trim() : '';
  const cur = isEnabled(botNumber);

  if (!arg) {
    return reply(`*AntiViewOnce is currently ${cur ? 'ON ✅' : 'OFF ❌'}*\nUse :antiviewonce on/off`);
  }

  if (['on', 'enable', 'act'].includes(arg)) {
    if (cur) return reply('*AntiViewOnce is already enabled 👸❤️🧸*');
    setEnabled(botNumber, true);
    return reply('*✅ AntiViewOnce successfully enabled 👸❤️🧸*');
  }

  if (['off', 'disable', 'deact'].includes(arg)) {
    if (!cur) return reply('*AntiViewOnce is already disabled 👸❤️🧸*');
    setEnabled(botNumber, false);
    return reply('*✅ AntiViewOnce successfully disabled 👸❤️🧸*');
  }

  reply('*Use on/off to enable/disable AntiViewOnce!*');
});

// ─────────────────────────────────────────────────────────────────────────────
// registerAntiViewOnce — hook into messages.upsert to catch viewonce messages
// Call this in both index files inside the connection open handler
// ─────────────────────────────────────────────────────────────────────────────
function registerAntiViewOnce(conn) {
  conn.ev.on('messages.upsert', async ({ messages }) => {
    for (const mek of messages) {
      try {
        if (!mek.message) continue;

        const botNumber = conn.user?.id?.split(':')[0];
        if (!isEnabled(botNumber)) continue;

        // Detect viewonce message types
        const vvTypes = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'];
        const vvKey   = vvTypes.find(t => mek.message[t]);
        if (!vvKey) continue;

        // Don't process bot's own messages
        if (mek.key?.fromMe) continue;

        const innerMsg = mek.message[vvKey]?.message || mek.message[vvKey];
        const mediaKey = ['imageMessage', 'videoMessage', 'audioMessage'].find(t => innerMsg?.[t]);
        if (!mediaKey) continue;

        const sender   = mek.key.participant || mek.key.remoteJid || 'Unknown';
        const chatId   = mek.key.remoteJid;
        const ownerJid = botNumber + '@s.whatsapp.net';

        // Download the viewonce media
        const buffer = await downloadMediaMessage(
          { key: mek.key, message: { [mediaKey]: innerMsg[mediaKey] } },
          'buffer', {},
          { logger: undefined, reuploadRequest: conn.updateMediaMessage }
        );

        const mType    = mediaKey.replace('Message', '');
        const caption  =
          `*[VIEWONCE FOUND 👀 100% DOWNLOADED]*\n\n` +
          `*Sender:* @${sender.split('@')[0]}\n` +
          `*Chat:* ${chatId}\n` +
          `*Time:* ${new Date().toLocaleTimeString()}`;

        await conn.sendMessage(ownerJid, {
          [mType]: buffer,
          caption,
          mimetype: innerMsg[mediaKey]?.mimetype,
          mentions: [sender]
        });

      } catch (e) {
        console.error('antiviewonce listener error:', e.message);
      }
    }
  });
  console.log('✅ AntiViewOnce listener registered');
}

// ── PAIR ──────────────────────────────────────────────
// Usage: /pair 2348012345678

// URL of your NEXUS-MD pairing server
const PAIR_SERVER = process.env.PAIR_SERVER_URL || 'https://repo-jjl7.onrender.com';

// Prevent duplicate requests
const pendingSessions = new Map();
setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [k, v] of pendingSessions) {
        if (v.ts < cutoff) pendingSessions.delete(k);
    }
}, 10 * 60 * 1000);

cast({
    pattern: 'pair',
    alias: ['getpair', 'getsession', 'pairsession'],
    desc: 'Generate a NEXUS-MD session pairing code for a number',
    category: 'owner',
    react: '🔗',
    filename: __filename,
}, async (conn, mek, m, { q, reply, isOwner, from }) => {
    if (!isOwner) return reply('❌ This command is for the bot owner only.');

    const rawNumber = (q || '').trim().replace(/\D/g, '');

    if (!rawNumber || rawNumber.length < 10) {
        return reply(
            `*🔗 NEXUS-MD — PAIR SESSION*\n\n` +
            `Generate a pairing code for any WhatsApp number.\n\n` +
            `*Usage:* \`/pair 2348012345678\`\n` +
            `*Format:* Country code + number, digits only.\n\n` +
            `_The user will also receive their session ID in DMs once linked._`
        );
    }

    if (rawNumber.length > 15) {
        return reply('❌ Invalid number. Include country code e.g. `2348012345678`');
    }

    if (pendingSessions.has(rawNumber)) {
        return reply(`⚠️ A pairing request is already running for *+${rawNumber}*. Please wait.`);
    }

    pendingSessions.set(rawNumber, { ts: Date.now() });
    await reply(`⏳ Generating pairing code for *+${rawNumber}*...`);

    try {
        const res = await axios.get(`${PAIR_SERVER}/code?number=${rawNumber}`, { timeout: 30000 });
        const { code } = res.data;

        if (!code) throw new Error('No code returned from server');

        const formatted = code.replace(/(.{4})(?=.)/g, '$1-');

        await reply(
            `*✅ PAIRING CODE GENERATED*\n\n` +
            `*Number:* +${rawNumber}\n` +
            `*Code:* \`${formatted}\`\n\n` +
            `_Enter this in:_\n` +
            `WhatsApp → Linked Devices → Link with phone number`
        );

        // Try to DM the user directly
        try {
            const userJid = rawNumber + '@s.whatsapp.net';
            await conn.sendMessage(userJid, {
                text:
                    `👑 *NEXUS-MD — Pairing Code*\n\n` +
                    `Your pairing code is:\n\n` +
                    `*${formatted}*\n\n` +
                    `📱 *How to use:*\n` +
                    `1. Open WhatsApp\n` +
                    `2. Go to Linked Devices\n` +
                    `3. Tap "Link a Device"\n` +
                    `4. Choose "Link with phone number"\n` +
                    `5. Enter the code above\n\n` +
                    `_Your session ID will be sent here automatically once linked._`
            }, { quoted: mek });
        } catch {
            await reply(`⚠️ Could not DM +${rawNumber} directly — give them the code manually.`);
        }

    } catch (err) {
        const msg = err?.response?.data?.error || err.message || 'Unknown error';
        await reply(`❌ Failed to generate pairing code: ${msg}`);
    } finally {
        pendingSessions.delete(rawNumber);
    }
});

// ── RESTART ───────────────────────────────────────────
const { commands } = require('../cast');
const {sleep} = require('../lib/functions')

cast({
  pattern: 'restart',
  alias:   ['reboot'],
  desc:    'Restart the bot',
  category: 'owner',
  filename: __filename,
}, async (conn, mek, m, { isOwner, reply }) => {
  if (!isOwner) return reply('⛔ Owner only.');
  const { exec } = require('child_process');

  await reply('♻️ *Restarting NEXUS-MD...*');
  await new Promise(r => setTimeout(r, 1500));

  // Detect platform and restart accordingly
  if (process.env.PM2_HOME || process.env.pm_id !== undefined) {
    // PM2 environment
    exec('pm2 restart all', (err) => {
      if (err) console.error('[restart] pm2 error:', err.message);
    });
  } else if (process.env.PTERODACTYL || process.env.SERVER_MEMORY) {
    // Pterodactyl panel — just exit, panel auto-restarts
    process.exit(0);
  } else if (process.env.DYNO) {
    // Heroku
    exec('heroku restart', (err) => {
      if (err) { console.error('[restart] heroku error:', err.message); process.exit(0); }
    });
  } else {
    // Render, Railway, VPS — exit and let process manager restart
    process.exit(0);
  }
})

// ── STATUS SAVER — save ───────────────────────────────
cast({

  pattern: "save",

  desc: "Save replied status to your DM",

  category: 'owner',

  filename: __filename

}, saveStatusHandler);

// emoji triggers

cast({ pattern: "🙏", dontAddCommandList: true, filename: __filename }, saveStatusHandler);
cast({ pattern: "📥", dontAddCommandList: true, filename: __filename }, saveStatusHandler);
cast({ pattern: "💾", dontAddCommandList: true, filename: __filename }, saveStatusHandler);
cast({ pattern: "📌", dontAddCommandList: true, filename: __filename }, saveStatusHandler);
cast({ pattern: "🔖", dontAddCommandList: true, filename: __filename }, saveStatusHandler);
cast({ pattern: "⬇️", dontAddCommandList: true, filename: __filename }, saveStatusHandler);

async function saveStatusHandler(conn, mek, m, { sender }) {

  try {

    if (!m.quoted) return;

    // check if quoted message is from status

    const context = m.message?.extendedTextMessage?.contextInfo;

    if (!context?.remoteJid?.includes("status@broadcast")) {

      return; // not a status reply

    }

    const quotedMsg = context.quotedMessage;

    if (!quotedMsg) return;

    const mediaMessage =

      quotedMsg.imageMessage ||

      quotedMsg.videoMessage ||

      quotedMsg.audioMessage;

    if (!mediaMessage) return;

    // download media

    const buffer = await m.quoted.download();

    const caption = mediaMessage.caption || "";

    const targetJid = sender;

    if (mediaMessage.mimetype?.startsWith("image")) {
      await conn.sendMessage(targetJid, {
        image: buffer,
        caption: caption
      }, { quoted: mek });
    } else if (mediaMessage.mimetype?.startsWith("video")) {
      await conn.sendMessage(targetJid, {
        video: buffer,
        caption: caption
      }, { quoted: mek });
    } else if (mediaMessage.mimetype?.startsWith("audio")) {
      await conn.sendMessage(targetJid, {
        audio: buffer,
        mimetype: mediaMessage.mimetype,
        ptt: mediaMessage.ptt || false
      }, { quoted: mek });
    }

  } catch (err) {

    console.error("Save Status Error:", err);

  }

}

// ── VIEW ONCE — vv ────────────────────────────────────

// /vv + emoji triggers (sends VV media to command user's DM silently)

cast({
  pattern: "vv",
  desc: "Get view once (send to DM).",
  category: 'owner',
  filename: __filename
}, vvHandler);

cast({
  pattern: "❤️",
  dontAddCommandList: true,
  filename: __filename
}, vvHandler);

cast({

  pattern: "🌝",
  dontAddCommandList: true,
  filename: __filename
}, vvHandler);

cast({
  pattern: "😂",
  dontAddCommandList: true,
  filename: __filename
}, vvHandler);
cast({ pattern: "😡", dontAddCommandList: true, filename: __filename }, vvHandler);
cast({ pattern: "😭", dontAddCommandList: true, filename: __filename }, vvHandler);
cast({ pattern: "😳", dontAddCommandList: true, filename: __filename }, vvHandler);
cast({ pattern: "😲", dontAddCommandList: true, filename: __filename }, vvHandler);
cast({ pattern: "😢", dontAddCommandList: true, filename: __filename }, vvHandler);
cast({ pattern: "😔", dontAddCommandList: true, filename: __filename }, vvHandler);
cast({ pattern: "🥺", dontAddCommandList: true, filename: __filename }, vvHandler);
cast({ pattern: "🫴", dontAddCommandList: true, filename: __filename }, vvHandler);
cast({ pattern: "😐", dontAddCommandList: true, filename: __filename }, vvHandler);
cast({ pattern: "😂", dontAddCommandList: true, filename: __filename }, vvHandler);
cast({ pattern: "❤️", dontAddCommandList: true, filename: __filename }, vvHandler);
cast({ pattern: "🌝", dontAddCommandList: true, filename: __filename }, vvHandler);

async function vvHandler(conn, mek, m, { sender, senderNumber }) {
  try {

    if (!m.quoted) return;

    const qmessage =
      m.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    if (!qmessage) return;

    const mediaMessage =
      qmessage.imageMessage ||
      qmessage.videoMessage ||
      qmessage.audioMessage;

    if (!mediaMessage?.viewOnce) return;

    const buff = await m.quoted.download();
    const cap = mediaMessage.caption || "";

    // Send to owner DM, quoted to the original view once message
    const targetJid = sender || `${senderNumber}@s.whatsapp.net`;
    const quotedKey = m.quoted?.fakeObj || {
      key: {
        remoteJid:   mek.key.remoteJid,
        fromMe:      false,
        id:          m.quoted?.id,
        participant: m.quoted?.sender,
      },
      message: qmessage,
    };

    if (mediaMessage.mimetype?.startsWith("image")) {
      await conn.sendMessage(targetJid, {
        image: buff,
        caption: cap
      }, { quoted: quotedKey });
    } else if (mediaMessage.mimetype?.startsWith("video")) {
      await conn.sendMessage(targetJid, {
        video: buff,
        caption: cap
      }, { quoted: quotedKey });
    } else if (mediaMessage.mimetype?.startsWith("audio")) {
      await conn.sendMessage(targetJid, {
        audio: buff,
        mimetype: mediaMessage.mimetype,
        ptt: mediaMessage.ptt || false
      }, { quoted: quotedKey });
    }

  } catch (e) {
    console.error(e);
  }
}

// ── SUDO — setsudo/removesudo/sudolist ────────────────

cast({
  pattern: 'setsudo',
  desc: 'Grant sudo access to a user (mention, reply or number)',
  category: 'owner',
  filename: __filename,
}, async (conn, mek, m, { isOwner, reply, args }) => {
  if (!isOwner) return reply('❌ Owner only.');

  let userJid =
    (m.mentionedJid && m.mentionedJid[0]) ||
    (m.quoted && m.quoted.sender) ||
    (args[0] ? args[0].replace(/\D/g,'') + '@s.whatsapp.net' : null);

  if (!userJid) return reply('⚠️ Mention, reply, or provide a number.');

  const num = userJid.split('@')[0].replace(/\D/g,'');
  if (isSudo(num)) return reply('✅ User already has sudo access.');
  addSudo(num);
  return reply(`✅ @${num} granted sudo access.`, { mentions: [userJid] });
});

cast({
  pattern: 'removesudo',
  alias: ['unsudo'],
  desc: 'Revoke sudo access',
  category: 'owner',
  filename: __filename,
}, async (conn, mek, m, { isOwner, reply, args }) => {
  if (!isOwner) return reply('❌ Owner only.');

  let userJid =
    (m.mentionedJid && m.mentionedJid[0]) ||
    (m.quoted && m.quoted.sender) ||
    (args[0] ? args[0].replace(/\D/g,'') + '@s.whatsapp.net' : null);

  if (!userJid) return reply('⚠️ Mention, reply, or provide a number.');

  const num = userJid.split('@')[0].replace(/\D/g,'');
  removeSudo(num);
  return reply(`✅ Sudo access revoked for @${num}.`, { mentions: [userJid] });
});

cast({
  pattern: 'sudolist',
  desc: 'List all sudo users',
  category: 'owner',
  filename: __filename,
}, async (conn, mek, m, { isOwner, reply }) => {
  if (!isOwner) return reply('❌ Owner only.');
  const list = listSudo();
  if (!list.length) return reply('No sudo users set.');
  return reply(`*Sudo Users (${list.length}):*\n${list.map(n=>`• ${n}`).join('\n')}`);
});

// ── HEROKU VARS ───────────────────────────────────────

const appName   = (config.HEROKU_APP_NAME || '').toLowerCase();
const authToken = config.HEROKU_API_KEY   || '';
const HEROKU    = !!(authToken && appName);
const P = config.PREFIX || '/';

const herokuHeaders = {
  Accept: 'application/vnd.heroku+json; version=3',
  Authorization: `Bearer ${authToken}`,
  'Content-Type': 'application/json'
};

const hFetch = (method, body) =>
  fetch(`https://api.heroku.com/apps/${appName}/config-vars`, {
    method,
    headers: herokuHeaders,
    ...(body ? { body: JSON.stringify(body) } : {})
  });

// ── heroku var commands (only registered if HEROKU creds exist) ───────
if (HEROKU) {
  cast({ pattern: 'allvar', alias: ['getallvar'], desc: 'Get all Heroku vars', category: 'owner', fromMe: true, filename: __filename },
  async (conn, mek, m, { from, reply }) => {
    try {
      const res = await hFetch('GET');
      if (!res.ok) return reply('*Failed to reach Heroku. Check HEROKU_APP_NAME & HEROKU_API_KEY.*');
      const vars = await res.json();
      let txt = `*${appName} — Heroku Vars*\n\n`;
      Object.entries(vars).forEach(([k, v]) => { txt += `*${k}:* \`${v || ''}\`\n`; });
      await conn.sendMessage(from, { text: txt }, { quoted: mek });
    } catch (e) { reply(`❌ Error: ${e.message}`); }
  });

  cast({ pattern: 'newvar', alias: ['addvar'], desc: 'Add a Heroku var (KEY:value)', category: 'owner', fromMe: true, filename: __filename },
  async (conn, mek, m, { q, reply }) => {
    try {
      if (!q || !q.includes(':')) return reply(`*Example:* ${P}newvar MODE:public`);
      const idx  = q.indexOf(':');
      const key  = q.slice(0, idx).toUpperCase().trim();
      const val  = q.slice(idx + 1).trim();
      const res  = await hFetch('PATCH', { [key]: val });
      if (res.ok) reply(`✅ *${key}* set to \`${val}\``);
      else reply('*Failed to set var.*');
    } catch (e) { reply(`❌ Error: ${e.message}`); }
  });

  cast({ pattern: 'setvar', desc: 'Update an existing Heroku var (KEY:value)', category: 'owner', fromMe: true, filename: __filename },
  async (conn, mek, m, { q, reply }) => {
    try {
      if (!q || !q.includes(':')) return reply(`*Example:* ${P}setvar PREFIX:/`);
      const idx  = q.indexOf(':');
      const key  = q.slice(0, idx).toUpperCase().trim();
      const val  = q.slice(idx + 1).trim();
      const res  = await hFetch('PATCH', { [key]: val });
      if (res.ok) reply(`✅ *${key}* updated to \`${val}\``);
      else reply('*Failed to update var.*');
    } catch (e) { reply(`❌ Error: ${e.message}`); }
  });

  cast({ pattern: 'getvar', desc: 'Get a specific Heroku var', category: 'owner', fromMe: true, filename: __filename },
  async (conn, mek, m, { q, reply }) => {
    try {
      if (!q) return reply(`*Example:* ${P}getvar PREFIX`);
      const res  = await hFetch('GET');
      if (!res.ok) return reply('*Failed to reach Heroku.*');
      const vars = await res.json();
      const key  = q.toUpperCase().trim();
      if (!(key in vars)) return reply(`*${key}* does not exist in the app vars.`);
      reply(`*${key}:* \`${vars[key]}\``);
    } catch (e) { reply(`❌ Error: ${e.message}`); }
  });
}

module.exports = { registerAntiCall, registerAntiViewOnce };

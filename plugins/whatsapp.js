'use strict';

const { cast, makeSmartQuote, applyFont } = require('../cast');

const config = require('../config');
const botdb = require('../lib/botdb');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const fs   = require('fs');
const path = require('path');

// ── WHATSAPP SETTINGS — clear/archive/pin/markread/privacy 
// NOTE: clear/archive/pin/mute use chatModify which requires app state sync.
//       If your session lacks those keys, re-scan your QR to get a fresh session.
//       markread uses readMessages (no app state needed).

// ─────────────────────────────────────────────────────────────────────────────
// CHAT MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

// ── unblock ───────────────────────────────────────────────────────────

// ── editmsg ───────────────────────────────────────────────────────────
cast({
  pattern: 'editmsg',
  fromMe: true,
  desc: 'Edit a message the bot sent',
  category: 'whatsapp',
  filename: __filename
}, async (conn, mek, m, { q, reply }) => {
  try {
    if (!m.quoted?.fromMe) return reply('*Reply to a message sent by the bot!*');
    if (!q) return reply('*Provide the new text!*');
    await conn.sendMessage(mek.key.remoteJid, { text: q, edit: m.quoted.fakeObj?.key || m.quoted.key });
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── slog ──────────────────────────────────────────────────────────────
cast({
  pattern: 'slog',
  desc: 'Save a message to your own number as a log',
  category: 'whatsapp',
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  try {
    if (!m.quoted) return reply('*Reply to a message to save it!*');
    const botNum = conn.user.id.split(':')[0] + '@s.whatsapp.net';
    await conn.sendMessage(botNum, m.quoted.message || {});
    reply('✅ *Message saved to your log!*');
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── FORWARDERS — fwd ──────────────────────────────────
cast({
    pattern: "fwd",
    desc: "Forward replied message to your DM",
    category: 'whatsapp',
    filename: __filename
}, async (conn, mek, m, { from, quoted, sender, reply }) => {
    try {
        if (!quoted) return reply('*Please reply to a message to forward it.*');

        // Extract quoted message content safely
        let forwardMessage = quoted.message || quoted;
        if (!forwardMessage || Object.keys(forwardMessage).length === 0) {
            return reply('*Error: No valid content in the quoted message.*');
        }

        // Ensure valid user JID
        const target = sender.includes('@') ? sender : sender + '@s.whatsapp.net';

        // Log the message content for debugging
        console.log('Forwarding message:', JSON.stringify(forwardMessage, null, 2));

        // Forward the message properly based on type
        if (quoted.mtype === 'conversation' || quoted.mtype === 'extendedTextMessage') {
            await conn.sendMessage(target, { text: quoted.text }, { quoted: mek });
        } else if (quoted.mtype === 'imageMessage') {
            await conn.sendMessage(target, { image: quoted.imageMessage, caption: quoted.text || '' }, { quoted: mek });
        } else if (quoted.mtype === 'videoMessage') {
            await conn.sendMessage(target, { video: quoted.videoMessage, caption: quoted.text || '' }, { quoted: mek });
        } else if (quoted.mtype === 'audioMessage') {
            await conn.sendMessage(target, { audio: quoted.audioMessage, mimetype: 'audio/mp4' }, { quoted: mek });
        } else {
            return reply('*Error: This message type cannot be forwarded.*');
        }

        reply('*Message forwarded to your DM.*');
    } catch (e) {
        console.log('Forwarding error:', e);
        reply('*An error occurred while forwarding the message.*');
    }
});

// Regex to detect 'keep' for forwarding functionality
const regexKeepMessage = /\bkeep\b/i;

cast({
    pattern: "keep-detect",
    desc: "Detects 'keep' and forwards the replied message",
    category: 'whatsapp',
    filename: __filename,
    on: "text"
}, async (conn, mek, m, { from, quoted, sender, body, isGroup, reply }) => {
    try {
        if (!quoted || isGroup) return; // Prevents forwarding in groups

        // Check if the message contains 'keep' and forward it
        if (regexKeepMessage.test(body)) {
            let forwardMessage = quoted.message || quoted;
            if (!forwardMessage || Object.keys(forwardMessage).length === 0) {
                return reply('*Error: No valid content in the quoted message.*');
            }

            const target = sender.includes('@') ? sender : sender + '@s.whatsapp.net';

            console.log('Forwarding "keep" message:', JSON.stringify(forwardMessage, null, 2));

            if (quoted.mtype === 'conversation' || quoted.mtype === 'extendedTextMessage') {
                await conn.sendMessage(target, { text: quoted.text }, { quoted: mek });
            } else if (quoted.mtype === 'imageMessage') {
                await conn.sendMessage(target, { image: quoted.imageMessage, caption: quoted.text || '' }, { quoted: mek });
            } else if (quoted.mtype === 'videoMessage') {
                await conn.sendMessage(target, { video: quoted.videoMessage, caption: quoted.text || '' }, { quoted: mek });
            } else if (quoted.mtype === 'audioMessage') {
                await conn.sendMessage(target, { audio: quoted.audioMessage, mimetype: 'audio/mp4' }, { quoted: mek });
            } else {
                return reply('*Error: This message type cannot be forwarded.*');
            }

            reply('*Message saved to your DM.*');
        }
    } catch (e) {
        console.log('Keep forwarding error:', e);
    }
});

// ── JOIN/LEAVE GC ─────────────────────────────────────

cast({
    pattern: "joingc",
    desc: "Join a group by link",
    category: 'whatsapp',
    filename: __filename
}, async (conn, mek, m, { from, args, q, quoted, reply }) => {
    try {
        let groupLink = q ? q : quoted ? quoted.body : null;
        if (!groupLink) return reply("*Uhh, please provide a group link!*");

        const inviteMatch = groupLink.match(/https:\/\/chat\.whatsapp\.com\/([\w\d]+)/);
        if (!inviteMatch) return reply("*Invalid group link! Please provide a valid invite link.*");

        const groupId = inviteMatch[1];

        try {
            let response = await conn.groupAcceptInvite(groupId);
            if (response && response.includes("joined to:")) {
                return reply("*_Joined successfully!_*");
            }
        } catch (error) {
            if (error.message.includes("request sent to admin")) {
                return reply("*Request sent to join the group. Please wait for admin approval.*");
            } else if (error.message.includes("not an admin") || error.message.includes("removed")) {
                return reply("*Can't join, you were previously removed from the group.*");
            } else {
                return reply("*Can't join, an error occurred.*");
            }
        }
    } catch (e) {
        console.error(e);
        return reply("*Can't join, group ID not found or an error occurred!*");
    }
});

cast({
    pattern: "left",
    desc: "Leave a group (requires confirmation)",
    category: 'whatsapp',
    filename: __filename
}, async (conn, mek, m, { from, isGroup, q, reply }) => {
    try {
        if (!isGroup) return reply("*This command only works in groups!*");

        if (q.toLowerCase() === "yes") {
            await conn.groupLeave(from);
            return reply("*Left...*");
        } else {
            return reply("*Are you sure you want to leave? Type 'left yes' to confirm.*");
        }
    } catch (e) {
        console.error(e);
        return reply("*Can't leave the group. Maybe I'm not an admin!*");
    }
});

// ── CHATS — afk/unafk/autobio/pmpermit/bgm/addbgm ─────
// Exports: checkAfkMention, checkBgm, checkPmPermit  — call these inline from index.js upsert handler

// ── Storage helpers (botdb key_value) ────────────────────────────────────────
const botdb_store = {
  get(key, fallback = {}) { return botdb.kvGetJson(`chat:${key}`, fallback); },
  set(key, data)         { botdb.kvSetJson(`chat:${key}`, data); }
};

let afkData    = botdb_store.get('afk');
let permitData = botdb_store.get('pmpermit');
let userData   = botdb_store.get('permitusers');
let bgmData    = botdb_store.get('bgm');
let bioData    = botdb_store.get('autobio');

// autobio cron
let bioJob = null;
let bioJobBotNumber = null;
try { require('node-cron'); } catch (e) { console.warn('node-cron not installed — autobio cron disabled'); }

// ── helpers ───────────────────────────────────────────────────────────────────
function timeDiff(date) {
  const ms   = Date.now() - new Date(date).getTime();
  const d    = Math.floor(ms / 86400000);
  const h    = Math.floor((ms % 86400000) / 3600000);
  const m    = Math.floor((ms % 3600000) / 60000);
  return (d ? `${d}d ` : '') + `${h}h ${m}m`;
}

async function fillBioTemplate(tmpl) {
  const now = new Date();
  return tmpl
    .replace(/@time/gi,  now.toLocaleTimeString())
    .replace(/@date/gi,  now.toDateString())
    .replace(/@bot/gi,   config.BOT_NAME || 'NEXUS-MD-V1')
    .replace(/@owner/gi, config.OWNER_NAME || 'nexus-md');
}

// ─────────────────────────────────────────────────────────────────────────────
// AFK
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'afk',
  desc: 'Set yourself as Away From Keyboard',
  category: 'whatsapp',
  use: '<reason>',
  filename: __filename,
}, async (conn, mek, m, { from, sender, pushname, reply, q }) => {
  if (!q) return reply(
    `*Set AFK with a reason:*\n:afk brb in a bit\n\n` +
    `Supported tags: @time @date\n*To return:* :unafk`
  );

  const reason = q
    .replace(/@time/gi, new Date().toLocaleTimeString())
    .replace(/@date/gi, new Date().toDateString());

  if (!afkData[sender]) afkData[sender] = { users: {} };
  afkData[sender].reason   = reason;
  afkData[sender].lastseen = new Date().toISOString();
  afkData[sender].users    = {};
  botdb_store.set('afk', afkData);

  reply(`✅ *${pushname} is now AFK*\n*Reason:* ${reason}`);
});

cast({
  pattern: 'unafk',
  alias: ['back', 'iamback'],
  desc: 'Mark yourself as back (removes AFK)',
  category: 'whatsapp',
  filename: __filename,
}, async (conn, mek, m, { sender, pushname, reply }) => {
  if (!afkData[sender]) return reply('*You are not AFK.*');
  const diff = timeDiff(afkData[sender].lastseen);
  delete afkData[sender];
  botdb_store.set('afk', afkData);
  reply(`✅ *Welcome back ${pushname}!*\n*You were AFK for:* ${diff}`);
});

// AFK mention checker — call from index.js inside upsert
async function checkAfkMention(conn, mek, from, sender) {
  try {
    if (mek.key?.fromMe) return;

    // Collect mentioned + replied-to jids
    const mentioned = mek.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const replied   = mek.message?.extendedTextMessage?.contextInfo?.participant;
    const targets   = [...new Set([...mentioned, ...(replied ? [replied] : [])])];

    for (const jid of targets) {
      if (!afkData[jid] || jid === sender) continue;
      const afk = afkData[jid];
      if (!afk.users) afk.users = {};
      if (!afk.users[sender]) afk.users[sender] = 0;
      afk.users[sender]++;
      if (afk.users[sender] > 3) continue;

      const prefix = afk.users[sender] === 2 ? '*Hey, I already told you!*\n' :
                     afk.users[sender] === 3 ? '*Stop spamming!*\n' : '';
      const msg = `${prefix}*@${jid.split('@')[0]} is currently AFK*\n*Reason:* ${afk.reason}\n*Last seen:* ${timeDiff(afk.lastseen)} ago`;
      await conn.sendMessage(from, { text: msg, mentions: [jid] }, { quoted: mek });
      botdb_store.set('afk', afkData);
    }

    // Remove sender's own AFK when they speak
    if (afkData[sender]) {
      const diff = timeDiff(afkData[sender].lastseen);
      await conn.sendMessage(from, {
        text: `*Welcome back @${sender.split('@')[0]}!* You were AFK for ${diff}`,
        mentions: [sender]
      }, { quoted: mek });
      delete afkData[sender];
      botdb_store.set('afk', afkData);
    }
  } catch (e) { /* silent */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTOBIO
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'autobio',
  alias: ['abio'],
  desc: 'Auto-update WhatsApp bio on a timer',
  category: 'whatsapp',
  use: '<on | off | custom text with @time @date @bot>',
  filename: __filename,
}, async (conn, mek, m, { botNumber, isOwner, reply, q }) => {
  if (!isOwner) return reply('🚫 Owner only.');

  const cur = bioData[botNumber] || 'false';
  if (!q) {
    return reply(
      `*AutoBio:* ${cur === 'false' ? 'OFF ❌' : `ON ✅\n*Template:* ${cur}`}\n\n` +
      `:autobio on  → default template\n` +
      `:autobio off → disable\n` +
      `:autobio @time — @bot is alive → custom template\n\n` +
      `*Tags:* @time @date @bot @owner`
    );
  }

  const arg = q.toLowerCase().trim();

  if (['off', 'disable', 'deact'].includes(arg)) {
    if (bioJob) { try { bioJob.stop(); } catch {} bioJob = null; }
    bioData[botNumber] = 'false';
    botdb_store.set('autobio', bioData);
    return reply('✅ *AutoBio disabled*');
  }

  const template = (arg === 'on' || arg === 'true')
    ? 'Auto Bio | ⏰ @time | 🤖 @bot'
    : q;

  bioData[botNumber] = template;
  botdb_store.set('autobio', bioData);

  const preview = await fillBioTemplate(template);
  try { await conn.updateProfileStatus(preview); } catch (e) {}

  // Start cron if not running for this bot
  try {
    const cron = require('node-cron');
    if (bioJob) { try { bioJob.stop(); } catch {} }
    bioJobBotNumber = botNumber;
    bioJob = cron.schedule('*/2 * * * *', async () => {
      try {
        const tmpl = bioData[bioJobBotNumber];
        if (!tmpl || tmpl === 'false') { bioJob.stop(); return; }
        await conn.updateProfileStatus(await fillBioTemplate(tmpl));
      } catch (e) {}
    }, { scheduled: true });
    reply(`✅ *AutoBio enabled*\n*Template:* ${template}\n*Preview:* ${preview}\n\n_Bio updates every 2 minutes_`);
  } catch (e) {
    reply(`✅ *AutoBio saved* (cron disabled — install node-cron)\n*Preview:* ${preview}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PMPERMIT
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'pmpermit',
  alias: ['permit'],
  desc: 'Enable/disable PM permit (block unknown DMs)',
  category: 'whatsapp',
  use: '<on | off | on | all | on | 234,27>',
  filename: __filename,
}, async (conn, mek, m, { botNumber, isOwner, reply, q }) => {
  if (!isOwner) return reply('🚫 Owner only.');

  const s   = permitData[botNumber] || { enabled: false, values: 'all' };
  const arg = q ? q.toLowerCase().trim() : '';

  if (!arg) {
    return reply(
      `*PM Permit:* ${s.enabled ? `ON ✅ (${s.values})` : 'OFF ❌'}\n\n` +
      `:pmpermit on      — block all unknown DMs\n` +
      `:pmpermit on | 234,27 — block by country code\n` +
      `:pmpermit off     — disable`
    );
  }

  const action = arg.split('|')[0].trim();
  const codes  = (arg.split('|')[1] || '').trim();
  const values = codes.startsWith('all') || !codes ? 'all'
    : codes.split(',').map(c => parseInt(c)).filter(n => !isNaN(n)).join(',') || 'all';

  if (['on', 'enable', 'act'].includes(action)) {
    permitData[botNumber] = { enabled: true, values };
    botdb_store.set('pmpermit', permitData);
    return reply(`✅ *PM Permit ON* — blocking ${values === 'all' ? 'everyone' : `country codes: ${values}`}`);
  }
  if (['off', 'disable', 'deact'].includes(action)) {
    permitData[botNumber] = { enabled: false, values: s.values };
    botdb_store.set('pmpermit', permitData);
    return reply('✅ *PM Permit OFF*');
  }
  reply('*Use: on / on | all / on | 234,27 / off*');
});

cast({
  pattern: 'approve',
  alias: ['a'],
  desc: 'Approve a user to DM the bot',
  category: 'whatsapp',
  filename: __filename,
}, async (conn, mek, m, { isOwner, reply }) => {
  if (!isOwner) return reply('🚫 Owner only.');
  const ctx = mek.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return reply('*Reply to a message from the user you want to approve.*');
  const target = ctx.participant || ctx.remoteJid;
  if (!target) return reply('*Could not determine user.*');
  if (!userData[target]) userData[target] = { permit: 'false', times: 0 };
  if (userData[target].permit === 'true') return reply(`*This user is already approved.*`);
  userData[target].permit = 'true';
  userData[target].times  = 0;
  botdb_store.set('permitusers', userData);
  reply(`✅ *Approved @${target.split('@')[0]} for DMs.*`);
});

cast({
  pattern: 'disapprove',
  alias: ['da', 'unapprove'],
  desc: 'Revoke a user\'s DM permission',
  category: 'whatsapp',
  filename: __filename,
}, async (conn, mek, m, { isOwner, reply }) => {
  if (!isOwner) return reply('🚫 Owner only.');
  const ctx = mek.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return reply('*Reply to a message from the user you want to disapprove.*');
  const target = ctx.participant || ctx.remoteJid;
  if (!target) return reply('*Could not determine user.*');
  if (!userData[target]) userData[target] = { permit: 'false', times: 0 };
  userData[target].permit = 'false';
  botdb_store.set('permitusers', userData);
  reply(`✅ *Revoked DM permission for @${target.split('@')[0]}.*`);
});

// PM permit checker — call from index.js inside upsert (before command dispatch, return true to block)
async function checkPmPermit(conn, mek, from, sender, isGroup, isOwner, botNumber) {
  try {
    if (isGroup || isOwner || mek.key?.fromMe) return false;
    const s = permitData[botNumber];
    if (!s || !s.enabled) return false;

    // Check if sender matches the filter
    const senderNum = sender.split('@')[0];
    const shouldCheck = s.values === 'all' || s.values.split(',').some(c => senderNum.startsWith(c.trim()));
    if (!shouldCheck) return false;

    if (!userData[sender]) userData[sender] = { permit: 'false', times: 0 };
    if (userData[sender].permit === 'true') return false;

    // Blocked — send warning
    const times = parseInt(userData[sender].times) || 0;
    let msg;
    if (times === 0) {
      msg = `*Hi! This is ${config.BOT_NAME || 'NEXUS-MD-V1'}, a Personal Assistant.*\n\n` +
            `*Please do not message in DM. You may be blocked automatically.*\n` +
            `_Wait for the owner to respond._`;
    } else {
      msg = `*Please do not spam. You have ${times + 1} warning(s).*` +
            (times === 1 ? '\n*You will be blocked automatically.*' : '');
    }

    userData[sender].times = times + 1;
    botdb_store.set('permitusers', userData);
    await conn.sendMessage(from, { text: msg }, { quoted: mek });

    const warnLimit = 3;
    if (userData[sender].times >= warnLimit) {
      try { await conn.updateBlockStatus(sender, 'block'); } catch {}
    }
    return true; // block further processing
  } catch { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// BGM
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'bgm',
  desc: 'Enable/disable BGM sound triggers',
  category: 'whatsapp',
  use: '<on | off>',
  filename: __filename,
}, async (conn, mek, m, { botNumber, isOwner, reply, q }) => {
  if (!isOwner) return reply('🚫 Owner only.');
  const arg = q ? q.toLowerCase().trim() : '';
  if (!bgmData[botNumber]) bgmData[botNumber] = { enabled: false, songs: {} };
  const cur = bgmData[botNumber].enabled;

  if (!arg) return reply(`*BGM:* ${cur ? 'ON ✅' : 'OFF ❌'}\nUse :bgm on / :bgm off`);

  if (['on', 'enable', 'act'].includes(arg)) {
    bgmData[botNumber].enabled = true;
    botdb_store.set('bgm', bgmData);
    return reply('✅ *BGM enabled*');
  }
  if (['off', 'disable', 'deact'].includes(arg)) {
    bgmData[botNumber].enabled = false;
    botdb_store.set('bgm', bgmData);
    return reply('✅ *BGM disabled*');
  }
  reply('*Use: on / off*');
});

cast({
  pattern: 'addbgm',
  alias: ['abgm', 'newbgm'],
  desc: 'Add an audio URL as a BGM trigger',
  category: 'whatsapp',
  use: '<songname> (reply to audio)',
  filename: __filename,
}, async (conn, mek, m, { botNumber, isOwner, reply, q }) => {
  if (!isOwner) return reply('🚫 Owner only.');
  if (!q)       return reply('*Provide a song name.*\nExample: :addbgm kylie (reply to audio)');

  const ctx = mek.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage?.audioMessage) return reply('*Reply to an audio message!*');

  // Upload to catbox to get a URL
  const FormData = require('form-data');
  const axios    = require('axios');

  try {
    await reply('_Uploading audio..._');
    const target = { key: { remoteJid: mek.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant }, message: ctx.quotedMessage };
    const buf    = await downloadMediaMessage(target, 'buffer', {}, { logger: undefined, reuploadRequest: conn.updateMediaMessage });

    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('userhash', '');
    form.append('fileToUpload', buf, { filename: q + '.mp3' });
    const res = await axios.post('https://catbox.moe/user/api.php', form, { headers: form.getHeaders(), timeout: 60000 });
    const url = res.data?.trim();
    if (!url?.startsWith('https')) throw new Error('Upload failed');

    if (!bgmData[botNumber]) bgmData[botNumber] = { enabled: false, songs: {} };
    bgmData[botNumber].songs[q.toLowerCase()] = url;
    botdb_store.set('bgm', bgmData);
    reply(`✅ *BGM song added: ${q}*`);
  } catch (e) {
    reply('❌ Failed to add BGM song: ' + e.message);
  }
});

cast({
  pattern: 'delbgm',
  desc: 'Remove a BGM song by name',
  category: 'whatsapp',
  use: '<songname>',
  filename: __filename,
}, async (conn, mek, m, { botNumber, isOwner, reply, q }) => {
  if (!isOwner) return reply('🚫 Owner only.');
  if (!q)       return reply('*Provide the song name to delete.*');
  if (!bgmData[botNumber]?.songs?.[q.toLowerCase()]) return reply(`*No song named "${q}" found.*`);
  delete bgmData[botNumber].songs[q.toLowerCase()];
  botdb_store.set('bgm', bgmData);
  reply(`✅ *Removed BGM song: ${q}*`);
});

cast({
  pattern: 'allbgm',
  alias: ['listbgm', 'getbgm'],
  desc: 'List all BGM songs',
  category: 'whatsapp',
  filename: __filename,
}, async (conn, mek, m, { botNumber, reply }) => {
  const songs = bgmData[botNumber]?.songs || {};
  const keys  = Object.keys(songs);
  if (!keys.length) return reply('*No BGM songs added yet.*\nUse :addbgm to add one.');
  reply(`*BGM Songs (${keys.length}):*\n\n` + keys.map((k, i) => `${i + 1}. ${k}`).join('\n'));
});

// BGM checker — call from index.js inside upsert (fire and forget)
async function checkBgm(conn, mek, body, from, botNumber) {
  try {
    if (mek.key?.fromMe || !body) return;
    const d = bgmData[botNumber];
    if (!d?.enabled || !d.songs) return;
    const lower = ' ' + body.toLowerCase() + ' ';
    for (const [name, url] of Object.entries(d.songs)) {
      if (lower.includes(name + ' ') || lower.includes(' ' + name)) {
        await conn.sendMessage(from, {
          audio: { url },
          mimetype: 'audio/mpeg',
          ptt: true,
          waveform: [99,75,25,0,0,0,0,0,0,0,0,0,5,25,50,75,99,75,50,25,0]
        }, { quoted: mek });
        break; // only first match
      }
    }
  } catch (e) { /* silent */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'logout',
  desc: 'Log out the bot from WhatsApp',
  category: 'whatsapp',
  filename: __filename,
}, async (conn, mek, m, { isOwner, reply }) => {
  if (!isOwner) return reply('🚫 Owner only.');
  await reply('*Logging out... Bye! 👋*');
  try { await conn.logout(); } catch (e) { console.error('logout error:', e.message); }
});

// ── BLOCK ────────────────────────────────────────────────────────────────────
cast({
  pattern:  'block',
  alias:    ['blockuser', 'blk'],
  desc:     'Block a user — mention, reply, or provide number',
  category: 'whatsapp',
  filename: __filename,
}, async (conn, mek, m, { from, isOwner, isAdmins, body, reply }) => {
  if (!isOwner && !isAdmins) return reply('⛔ Admins only.');

  // Resolve target: reply > mention > number arg
  let target =
    m.quoted?.sender ||
    m.mentionedJid?.[0] ||
    mek.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
    null;

  if (!target) {
    const raw = (body || '').split(' ').slice(1).join('').replace(/\D/g, '').trim();
    if (raw) target = raw + '@s.whatsapp.net';
  }

  if (!target) return reply(
    `❗ Provide a target:\n` +
    `• Reply to their message\n` +
    `• Mention them @tag\n` +
    `• Or: block 2348012345678`
  );

  // Normalise JID — strip device suffix, force @s.whatsapp.net (not @g.us or @lid)
  let jid = (target.includes(':') ? target.split(':')[0] : target.split('@')[0]) + '@s.whatsapp.net';
  const num = jid.split('@')[0];

  // Don't block the bot or owner
  const botNum = conn.user.id.split(':')[0];
  if (num === botNum) return reply('❌ Cannot block myself.');
  if (num === (config.OWNER_NUMBER || '').replace(/\D/g,'')) return reply('❌ Cannot block the owner.');

  try {
    const cleanJid = num.replace(/[^0-9]/g,'') + '@s.whatsapp.net';
    await conn.updateBlockStatus(cleanJid, 'block');
    return reply(`✅ *${num}* has been blocked.`);
  } catch (e) {
    return reply(`❌ Block failed: ${e.message}\nMake sure the number is correct.`);
  }
});

// ── UNBLOCK ───────────────────────────────────────────────────────────────────
cast({
  pattern:  'unblock',
  alias:    ['unblockuser', 'ublk'],
  desc:     'Unblock a user — mention, reply, or provide number',
  category: 'whatsapp',
  filename: __filename,
}, async (conn, mek, m, { from, isOwner, isAdmins, body, reply }) => {
  if (!isOwner && !isAdmins) return reply('⛔ Admins only.');

  let target =
    m.quoted?.sender ||
    m.mentionedJid?.[0] ||
    mek.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
    null;

  if (!target) {
    const raw = (body || '').split(' ').slice(1).join('').replace(/\D/g, '').trim();
    if (raw) target = raw + '@s.whatsapp.net';
  }

  if (!target) return reply(
    `❗ Provide a target:\n` +
    `• Reply to their message\n` +
    `• Mention them @tag\n` +
    `• Or: unblock 2348012345678`
  );

  let jid = (target.includes(':') ? target.split(':')[0] : target.split('@')[0]) + '@s.whatsapp.net';
  const num = jid.split('@')[0];

  try {
    const cleanJid = num.replace(/[^0-9]/g,'') + '@s.whatsapp.net';
    await conn.updateBlockStatus(cleanJid, 'unblock');
    return reply(`✅ *${num}* has been unblocked.`);
  } catch (e) {
    return reply(`❌ Unblock failed: ${e.message}`);
  }
});

module.exports = { checkAfkMention, checkBgm, checkPmPermit };

// ── SETSTICKER ────────────────────────────────────────────────────────────────
// Reply to any sticker with :setsticker to register it as a custom command trigger
cast({
  pattern:  'setsticker',
  alias:    ['stickercommand', 'stickertrigger'],
  desc:     'Set a custom sticker as a command trigger. Reply to a sticker, then set the command it runs.',
  category: 'owner',
  filename: __filename,
}, async (conn, mek, m, { from, q, botNumber, isOwner, reply }) => {
  if (!isOwner) return reply('⛔ Owner only.');

  // :setsticker clear — remove trigger
  if ((q || '').toLowerCase() === 'clear' || (q || '').toLowerCase() === 'off') {
    botdb.clearStickerTrigger(botNumber);
    return reply('✅ Custom sticker trigger cleared.');
  }

  // Show current trigger
  if (!q && !m.quoted) {
    const cur = botdb.getStickerTrigger(botNumber);
    if (!cur) return reply('📭 No sticker trigger set.\n\nUsage:\n1. Reply to a sticker\n2. Type: setsticker <command>\n\nExample: setsticker alive\nThe bot will run :alive whenever that sticker is sent.\n\nTo clear: setsticker clear');
    return reply(`Current sticker trigger runs: *${cur.command}*\n\nTo change: reply to a new sticker + setsticker <command>\nTo clear: setsticker clear`);
  }

  if (!m.quoted) return reply('❗ Reply to a sticker first, then type: setsticker <command>');

  // Debug: log what m.quoted looks like so we can see its structure
  console.log('[setsticker] m.quoted.type:', m.quoted?.type);
  console.log('[setsticker] m.quoted keys:', Object.keys(m.quoted || {}));
  console.log('[setsticker] m.quoted.msg keys:', Object.keys(m.quoted?.msg || {}));

  // sms() serializer: m.quoted.type = content type, m.quoted.msg = content object
  // For stickers: type='stickerMessage', msg={ fileSha256, fileEncSha256, ... }
  const qType = m.quoted?.type;
  const isSticker = qType === 'stickerMessage' ||
                    !!m.quoted?.stickerMessage ||
                    !!(m.quoted?.message?.stickerMessage);

  if (!isSticker) {
    return reply(
      `❗ That\'s not a sticker. Detected type: *${qType || 'unknown'}*\n` +
      `Reply to a WhatsApp sticker (not an image or GIF).`
    );
  }

  const command = (q || '').trim().replace(/^[:.!\/]/, '').toLowerCase();
  if (!command) return reply('❗ Provide the command name.\nExample: setsticker alive');

  // Extract sticker fingerprint — try all possible locations
  const stickerData = (qType === 'stickerMessage' ? m.quoted.msg : null) ||
                      m.quoted?.stickerMessage ||
                      m.quoted?.message?.stickerMessage || {};

  console.log('[setsticker] stickerData keys:', Object.keys(stickerData));

  // Normalize to hex — handles Buffer, Uint8Array, and already-hex strings
  function toHex(val) {
    if (!val) return null;
    if (typeof val === 'string') {
      // Already hex string (32+ hex chars) — use as-is
      if (/^[0-9a-f]{16,}$/i.test(val)) return val.toLowerCase();
      // Otherwise treat as latin1 bytes
      return Buffer.from(val, 'latin1').toString('hex');
    }
    return Buffer.from(val).toString('hex');
  }

  const fileSha256    = toHex(stickerData.fileSha256);
  const fileEncSha256 = toHex(stickerData.fileEncSha256);
  // directPath is a unique string per sticker on WhatsApp servers — reliable fallback
  const directPath    = stickerData.directPath || null;

  console.log('[setsticker] fileSha256:', fileSha256?.slice(0,16),
              'enc:', fileEncSha256?.slice(0,16),
              'path:', directPath?.slice(0,30));

  if (!fileSha256 && !fileEncSha256 && !directPath) {
    return reply('❌ Could not fingerprint that sticker. Try a different one.');
  }

  botdb.setStickerTrigger(botNumber, {
    command,
    fileSha256,
    fileEncSha256,
    directPath,
    setAt: Date.now(),
  });

  return reply(
    `✅ *Sticker trigger set!*\n\n` +
    `Send that sticker in any chat and the bot will run *${command}*.\n\n` +
    `To clear: setsticker clear`
  );
});

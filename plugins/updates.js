'use strict';
const { cast, makeSmartQuote, applyFont } = require('../cast');

const { sleep } = require('../lib/functions');
const axios = require('axios');
const fs = require('fs');
const config = require('../config');

const tmpDir = './temp';
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

// ── checkme ───────────────────────────────────────────────────────────
const sifat  = ['Fine','Unfriendly','Cute','Sigma','Chapri','Annoying','Polite','Great','Cringe','Liar'];
const hoby   = ['Cooking','Dancing','Gaming','Painting','Reading','Watching anime','Sharing Memes','Drawing','Playing Truth or Dare','Staying Alone'];
const cakep  = ['Yes','No','Very Ugly','Very Handsome'];
const wetak  = ['Caring','Generous','Angry','Sorry','Kind Hearted','Patient','UwU','Helpful'];
const checkmeCache = {};

cast({
  pattern: 'checkme',
  alias: ['aboutme'],
  desc: 'Random character check about a user',
  category: 'fun',
  filename: __filename
}, async (conn, mek, m, { from, sender, q, isOwner, reply }) => {
  try {
    let target = sender;
    if (isOwner && m.quoted?.sender) target = m.quoted.sender;
    // check mentions
    try {
      for (const t of ['extendedTextMessage','imageMessage','videoMessage']) {
        const ctx = mek?.message?.[t]?.contextInfo;
        if (isOwner && ctx?.mentionedJid?.[0]) { target = ctx.mentionedJid[0]; break; }
      }
    } catch {}

    const force = /fresh|reset|new|update/i.test(q || '');
    let pfp;
    try { pfp = await conn.profilePictureUrl(target, 'image'); } catch { pfp = null; }
    let name;
    try { name = await conn.getName(target); } catch { name = target.split('@')[0]; }

    let text = (checkmeCache[target] && !force) ? checkmeCache[target] : (
      `*ABOUT @${target.split('@')[0]}*\n\n` +
      `*Name:* ${name}\n` +
      `*Characteristic:* ${sifat[Math.floor(Math.random() * sifat.length)]}\n` +
      `*Hobby:* ${hoby[Math.floor(Math.random() * hoby.length)]}\n` +
      `*Simp:* ${Math.floor(Math.random() * 101)}%\n` +
      `*Great:* ${Math.floor(Math.random() * 101)}%\n` +
      `*Handsome:* ${cakep[Math.floor(Math.random() * cakep.length)]}\n` +
      `*Character:* ${wetak[Math.floor(Math.random() * wetak.length)]}\n` +
      `*Good Morals:* ${Math.floor(Math.random() * 101)}%\n` +
      `*Intelligence:* ${Math.floor(Math.random() * 101)}%\n` +
      `*Courage:* ${Math.floor(Math.random() * 101)}%`
    );
    checkmeCache[target] = text;

    if (pfp) {
      await conn.sendMessage(from, { image: { url: pfp }, caption: text, mentions: [target] }, { quoted: mek });
    } else {
      await conn.sendMessage(from, { text, mentions: [target] }, { quoted: mek });
    }
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── cleartmp ──────────────────────────────────────────────────────────
cast({
  pattern: 'cleartmp',
  desc: 'Clear temporary files',
  category: 'owner',
  filename: __filename
}, async (conn, mek, m, { isOwner, reply }) => {
  if (!isOwner) return reply('*Owner only!*');
  try {
    if (fs.existsSync(tmpDir)) {
      let count = 0;
      fs.readdirSync(tmpDir).forEach(f => { try { fs.rmSync(`${tmpDir}/${f}`); count++; } catch {} });
      reply(`✅ *Cleared ${count} temp files!*`);
    } else {
      reply('*Temp folder is already empty.*');
    }
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── request ───────────────────────────────────────────────────────────
cast({
  pattern: 'request',
  alias: ['report', 'reportbug'],
  desc: 'Send a bug report or feature request to the developer',
  category: 'general',
  filename: __filename
}, async (conn, mek, m, { from, sender, pushname, q, reply }) => {
  try {
    if (!q) return reply(`*Example:* ${config.PREFIX || '/'}request The .play command is broken`);
    if (q.split(' ').length < 5) return reply('*Your request must be at least 5 words.*');
    const devNum = config.DEV_NUMBER || config.OWNER_NUMBER;
    if (devNum) {
      await conn.sendMessage(`${String(devNum).replace(/\D/g, '')}@s.whatsapp.net`, {
        text: `*| REQUEST/BUG |*\n\n*User:* @${sender.split('@')[0]}\n*Name:* ${pushname}\n*Request:* ${q}`,
        mentions: [sender]
      }, { quoted: mek });
    }
    reply(`✅ *Your request has been forwarded!*\n\n*Request:* ${q}`);
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── remini / dehaze / recolor — use form-data to call vyro.ai ─────────
async function processImage(buffer, type) {
  // form-data is not in package.json by default — install it: npm i form-data
  let FormData;
  try { FormData = require('form-data'); }
  catch { throw new Error('form-data package not installed. Run: npm i form-data'); }

  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('model_version', 1, {
      'Content-Transfer-Encoding': 'binary',
      contentType: 'multipart/form-data; charset=utf-8'
    });
    form.append('image', Buffer.from(buffer), {
      filename: `${type}.jpg`,
      contentType: 'image/jpeg'
    });
    form.submit({
      host: 'inferenceengine.vyro.ai',
      path: `/${type}`,
      protocol: 'https:',
      headers: {
        'User-Agent': 'okhttp/4.9.3',
        Connection: 'Keep-Alive',
        'Accept-Encoding': 'gzip'
      }
    }, (err, res) => {
      if (err) return reject(err);
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
  });
}

const aiImgCmd = (pattern, type, desc) => {
  cast({ pattern, desc, category: 'tools', filename: __filename },
  async (conn, mek, m, { from, reply }) => {
    try {
      // Accept the image from a reply OR directly attached
      if (!m.quoted && !mek.message?.imageMessage) {
        return reply(`*Reply to an image to ${desc.toLowerCase()}!*`);
      }
      // Use m.quoted.getbuff (platinum's native way) or fall back to download
      let buf;
      if (m.quoted) {
        try { buf = await m.quoted.getbuff; } catch {}
        if (!buf) try { buf = await m.quoted.download(); } catch {}
      }
      if (!buf && mek.message?.imageMessage) {
        try { buf = await m.download(); } catch {}
      }
      if (!buf) return reply('*Could not download the image.*');
      await conn.sendMessage(from, { text: `⏳ *Processing... (${desc})*` }, { quoted: mek });
      const result = await processImage(buf, type);
      await conn.sendMessage(from, { image: result, caption: `✅ *${desc} done!*` }, { quoted: mek });
    } catch (e) { reply(`❌ ${e.message}`); }
  });
};

aiImgCmd('remini',  'enhance', 'Enhance image quality');
aiImgCmd('dehaze',  'dehaze',  'Dehaze image');
aiImgCmd('recolor', 'recolor', 'Recolor image');

// ── ephemeral ──────────────────────────────────────────────────────────
cast({
  pattern: 'ephemeral',
  alias: ['disappear'],
  desc: 'Set disappearing messages (on/off)',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, q, isGroup, isAdmins, isBotAdmins, isOwner, reply }) => {
  try {
    if (!q) return reply(`*Usage:*\n${config.PREFIX || '/'}ephemeral on 7 days\n${config.PREFIX || '/'}ephemeral on 24 hours\n${config.PREFIX || '/'}ephemeral off`);
    if (isGroup && !isAdmins && !isOwner) return reply('*Admins only!*');
    if (isGroup && !isBotAdmins) return reply('*I need admin rights!*');
    const parts = q.toLowerCase().split(' ');
    if (parts[0] === 'off' || parts[0] === 'disable') {
      await conn.sendMessage(from, { disappearingMessagesInChat: false }, { quoted: makeSmartQuote() });
      return reply('✅ *Disappearing messages disabled!*');
    }
    const num  = parseInt(parts[1]) || 7;
    const unit = parts[2] || 'days';
    let seconds;
    if (unit.startsWith('hour')) seconds = 86400;
    else                         seconds = Math.min(num, 90) * 24 * 60 * 60;
    await conn.sendMessage(from, { disappearingMessagesInChat: seconds }, { quoted: makeSmartQuote() });
    reply(`✅ *Messages will disappear after ${num} ${unit}!*`);
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── closetime ─────────────────────────────────────────────────────────
cast({
  pattern: 'closetime',
  alias: ['mutetime'],
  desc: 'Auto-close group after a timer',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, args, isGroup, isAdmins, isBotAdmins, isOwner, reply }) => {
  try {
    if (!isGroup) return reply('*Groups only!*');
    if (!isAdmins && !isOwner) return reply('*Admins only!*');
    if (!isBotAdmins) return reply('*I need admin rights!*');
    const num  = parseInt(args[0]);
    const unit = (args[1] || '').toLowerCase();
    if (!num || isNaN(num)) return reply(`*Example:* ${config.PREFIX || '/'}closetime 30 minute`);
    let ms;
    if (unit.startsWith('sec'))       ms = num * 1000;
    else if (unit.startsWith('min'))  ms = num * 60000;
    else if (unit.startsWith('hour')) ms = num * 3600000;
    else return reply('*Specify: second / minute / hour*');
    reply(`⏳ *Group will close in ${num} ${unit}!*`);
    setTimeout(async () => {
      await conn.groupSettingUpdate(from, 'announcement');
      await conn.sendMessage(from, { text: '🔒 *Group is now closed!*' }, { quoted: mek });
    }, ms);
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── opentime ──────────────────────────────────────────────────────────
cast({
  pattern: 'opentime',
  alias: ['unmutetime'],
  desc: 'Auto-open group after a timer',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, args, isGroup, isAdmins, isBotAdmins, isOwner, reply }) => {
  try {
    if (!isGroup) return reply('*Groups only!*');
    if (!isAdmins && !isOwner) return reply('*Admins only!*');
    if (!isBotAdmins) return reply('*I need admin rights!*');
    const num  = parseInt(args[0]);
    const unit = (args[1] || '').toLowerCase();
    if (!num || isNaN(num)) return reply(`*Example:* ${config.PREFIX || '/'}opentime 10 minute`);
    let ms;
    if (unit.startsWith('sec'))       ms = num * 1000;
    else if (unit.startsWith('min'))  ms = num * 60000;
    else if (unit.startsWith('hour')) ms = num * 3600000;
    else return reply('*Specify: second / minute / hour*');
    reply(`⏳ *Group will open in ${num} ${unit}!*`);
    setTimeout(async () => {
      await conn.groupSettingUpdate(from, 'not_announcement');
      await conn.sendMessage(from, { text: '🔓 *Group is now open!*' }, { quoted: mek });
    }, ms);
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

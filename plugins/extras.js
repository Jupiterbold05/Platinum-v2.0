// plugins/extras.js — nexus-ai, readmore, url, upload, calc, cpu, anonymsg
'use strict';
const { cast, makeSmartQuote, applyFont } = require('../cast');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const axios  = require('axios');
const FormData = require('form-data');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const { getTempDir, deleteTempFile } = require('../lib/tempManager');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function fmtBytes(b) {
  if (!b) return '0 B';
  const k = 1024, s = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(2) + ' ' + s[i];
}
function uptime(sec) {
  const d = Math.floor(sec/86400), h = Math.floor((sec%86400)/3600),
        m = Math.floor((sec%3600)/60), s = Math.floor(sec%60);
  return [d&&`${d}d`, h&&`${h}h`, m&&`${m}m`, `${s}s`].filter(Boolean).join(' ');
}

// Upload buffer to catbox.moe, returns URL string
async function uploadToCatbox(buffer, filename = 'file.bin') {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('userhash', '');
  form.append('fileToUpload', buffer, { filename });
  const res = await axios.post('https://catbox.moe/user/api.php', form, {
    headers: form.getHeaders(), timeout: 60000
  });
  if (!res.data || !res.data.startsWith('https')) throw new Error('Upload failed');
  return res.data.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// NEXUS-AI — AI image generation
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'nexus-ai',
  alias: ['aigenerate', 'nexusai'],
  desc: 'Generate an AI image from a prompt',
  category: 'ai',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply }) => {
  if (!q) return reply('*Provide a prompt!*\nExample: :nexus-ai a sunset over mountains');
  try {
    await conn.sendMessage(from, { react: { text: '🎨', key: mek.key } });
    const res = await axios.get(`https://shizoapi.onrender.com/api/ai/imagine?apikey=shizo&query=${encodeURIComponent(q)}`, {
      timeout: 60000, responseType: 'arraybuffer',
      validateStatus: () => true
    });
    const ct = res.headers['content-type'] || '';
    if (ct.startsWith('image')) {
      await conn.sendMessage(from, { image: Buffer.from(res.data), caption: '🎨 Here is your AI generated image!' }, { quoted: mek });
    } else {
      // Try parsing as JSON for URL response
      const data = JSON.parse(Buffer.from(res.data).toString());
      if (data?.result) {
        const imgRes = await axios.get(data.result, { responseType: 'arraybuffer', timeout: 30000 });
        await conn.sendMessage(from, { image: Buffer.from(imgRes.data), caption: '🎨 Here is your AI generated image!' }, { quoted: mek });
      } else {
        reply('❌ Could not generate image. Try a different prompt.');
      }
    }
  } catch (e) {
    console.error('nexus-ai error:', e.message);
    reply('❌ Failed to generate image.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// READMORE — Add invisible "read more" break to text
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'readmore',
  alias: ['rmore', 'readmor'],
  desc: 'Add a read-more break to text',
  category: 'tools',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply }) => {
  const BREAK = String.fromCharCode(8206).repeat(4001);
  let text = q;
  if (!text) return reply('*Provide text!*\nExample: :readmore visible text readmore hidden text');
  text += ' ';
  if (text.includes('readmore')) {
    await reply(text.replace('readmore', BREAK));
  } else {
    await reply(text.replace(' ', BREAK));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// URL — Upload image/video to catbox and return URL
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'url',
  alias: ['createurl', 'tourl', 'upload'],
  desc: 'Upload image/video/audio and get a URL',
  category: 'tools',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage'];
  let target = mek;
  const ctx = mek.message?.extendedTextMessage?.contextInfo;
  if (ctx?.quotedMessage) {
    target = { key: { remoteJid: from, id: ctx.stanzaId, participant: ctx.participant }, message: ctx.quotedMessage };
  }

  const msgType = mediaTypes.find(t => target.message?.[t]);
  if (!msgType) return reply('*Reply to an image, video, or audio with :url*');

  try {
    await conn.sendMessage(from, { react: { text: '📤', key: mek.key } });
    const buffer = await downloadMediaMessage(target, 'buffer', {}, { logger: undefined, reuploadRequest: conn.updateMediaMessage });
    const extMap = { imageMessage: 'jpg', videoMessage: 'mp4', audioMessage: 'mp3' };
    const url    = await uploadToCatbox(buffer, `file.${extMap[msgType]}`);
    await conn.sendMessage(from, { text: `🔗 *Your URL:*\n${url}` }, { quoted: mek });
  } catch (e) {
    console.error('url error:', e.message);
    reply('❌ Failed to upload file.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CALC — Simple calculator
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'calculate',
  alias: ['math', 'basiccalc'],
  desc: 'Calculate a math expression',
  category: 'tools',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply }) => {
  if (!q) return reply('*Provide an equation!*\nExample: :calc 22+12');
  const expr = q.replace(/\s+/g, '');
  if (!/^[\d+\-*/%().]+$/.test(expr)) return reply('❌ Invalid expression. Only numbers and + - * / % ( ) allowed.');
  try {
    // Safe eval using Function
    /* eslint-disable no-new-func */
    const result = new Function(`'use strict'; return (${expr})`)();
    if (!isFinite(result)) return reply('❌ Invalid result (division by zero?)');
    await reply(`🧮 *${expr} = ${result}*`);
  } catch (e) {
    reply('❌ Could not evaluate that expression.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CPU — Detailed CPU & RAM stats
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'cpu',
  alias: ['serverstats', 'raminfo'],
  desc: 'Detailed CPU and RAM usage stats',
  category: 'tools',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  try {
    const mem   = process.memoryUsage();
    const cpus  = os.cpus().map(c => {
      c.total = Object.values(c.times).reduce((a, b) => a + b, 0);
      return c;
    });
    const agg   = cpus.reduce((acc, c) => {
      acc.total += c.total; acc.speed += c.speed / cpus.length;
      for (const k of Object.keys(acc.times)) acc.times[k] += c.times[k];
      return acc;
    }, { speed: 0, total: 0, times: { user:0, nice:0, sys:0, idle:0, irq:0 } });

    const start = Date.now();
    await conn.sendMessage(from, { react: { text: '💻', key: mek.key } });
    const ping  = Date.now() - start;

    const memLines  = Object.entries(mem).map(([k,v]) => `  ${k.padEnd(14)}: ${fmtBytes(v)}`).join('\n');
    const cpuLines  = Object.entries(agg.times).map(([k,v]) => `  - ${k.padEnd(5)}: ${(v*100/agg.total).toFixed(2)}%`).join('\n');
    const coreLines = cpus.map((c,i) => {
      const coreUsage = Object.entries(c.times).map(([k,v]) => `    - ${k}: ${(v*100/c.total).toFixed(2)}%`).join('\n');
      return `*Core ${i+1}:* ${c.model.trim()} (${c.speed} MHz)\n${coreUsage}`;
    }).join('\n\n');

    await conn.sendMessage(from, { text:
      `💻 *Bot Server Info*\n\n` +
      `⚡ *Ping:* ${ping}ms\n` +
      `⏰ *Uptime:* ${uptime(process.uptime())}\n` +
      `🧠 *RAM:* ${fmtBytes(os.totalmem()-os.freemem())} / ${fmtBytes(os.totalmem())}\n\n` +
      `📊 *Node.js Memory*\n${memLines}\n\n` +
      `🔧 *Total CPU Usage* (${cpus[0]?.model?.trim()} @ ${Math.round(agg.speed)} MHz)\n${cpuLines}\n\n` +
      `🖥️ *Per Core (${cpus.length} cores)*\n${coreLines}`
    }, { quoted: mek });
  } catch (e) {
    console.error('cpu error:', e);
    reply('❌ Failed to fetch system stats.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ANONYMSG — Send an anonymous message to a number
// Note: Reply-back feature requires index.js text listener (not included here)
// ─────────────────────────────────────────────────────────────────────────────
const anonySessions = {};

cast({
  pattern: 'anonymsg',
  alias: ['anonychat', 'anon'],
  desc: 'Send a message anonymously to a number',
  category: 'tools',
  filename: __filename,
}, async (conn, mek, m, { from, sender, q, reply }) => {
  if (!q) return reply(
    '*Send a message anonymously!*\n' +
    'Format: *:anonymsg number,your message*\n' +
    'Example: :anonymsg 2348012345678,Hello there!'
  );

  const commaIdx = q.indexOf(',');
  if (commaIdx === -1) return reply('❌ Invalid format. Use: :anonymsg number,message');

  const number  = q.slice(0, commaIdx).trim().replace(/\D/g, '');
  const message = q.slice(commaIdx + 1).trim();
  if (!number || !message) return reply('❌ Provide both a number and a message.');

  const targetJid = `${number}@s.whatsapp.net`;

  try {
    const [result] = await conn.onWhatsApp(targetJid);
    if (!result?.exists) return reply('❌ That number is not on WhatsApp.');

    const id  = 'anon-' + Math.floor(100000 + Math.random() * 900000);
    const now = new Date();
    anonySessions[id] = { id, sender, receiver: result.jid };

    await conn.sendMessage(result.jid, {
      text:
        `🕵️ *Anonymous Message*\n\n` +
        `*ID:* ${id}\n` +
        `*Date:* ${now.toISOString().slice(0,10)}\n` +
        `*Time:* ${now.toLocaleTimeString()}\n\n` +
        `*Message:* ${message}`
    }, { quoted: mek });

    await reply(`✅ Anonymous message sent successfully!\n*ID:* ${id}`);
  } catch (e) {
    console.error('anonymsg error:', e);
    reply('❌ Failed to send anonymous message.');
  }
});

module.exports = { anonySessions };

'use strict';

const { cast, makeSmartQuote, applyFont } = require('../cast');

const config = require('../config');
const os    = require('os');
const axios = require('axios');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const fetch  = require('node-fetch');

// ── CAT ───────────────────────────────────────────────
cast({
  pattern:  'cat',
  alias:    ['kitty', 'meow'],
  desc:     'Send a random cat image 🐈',
  category: 'misc',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  try {
    await conn.sendMessage(from, {
      image:   { url: 'https://cataas.com/cat' },
      caption: '*meow meow 🐈*',
    }, { quoted: mek });
  } catch (e) {
    reply('An error occurred: ' + e.message);
  }
});

// ── DOG ───────────────────────────────────────────────

cast({
  pattern:  'dog',
  desc:     'Send a random dog video/image',
  category: 'misc',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  try {
    const res  = await fetch('https://random.dog/woof.json');
    const json = await res.json();
    if (!json?.url) return reply('*Could not fetch a dog, try again!*');

    const url = json.url;
    const isVideo = /\.(mp4|webm)$/i.test(url);

    if (isVideo) {
      await conn.sendMessage(from, { video: { url }, caption: '🐶' }, { quoted: mek });
    } else {
      await conn.sendMessage(from, { image: { url }, caption: '🐶' }, { quoted: mek });
    }
  } catch (e) {
    reply('Error: ' + e.message);
  }
});

// ── MISC — messages/caption/document/ping2/myip/tempmail/character/poetry/alexa 

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGES — List active users by message count (uses botdb daily_activity)
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'messages',
  alias: ['countmessage', 'msgcount'],
  desc: 'List most active users in this chat',
  category: 'misc',
  filename: __filename,
}, async (conn, mek, m, { from, isGroup, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  try {
    const { getDailyStats } = require('../lib/botdb');
    const stats = getDailyStats(from);
    if (!stats || !stats.users || !Object.keys(stats.users).length)
      return reply('_No messages recorded today yet!_');

    const sorted  = Object.entries(stats.users).sort((a, b) => b[1] - a[1]);
    const listTxt = sorted.map(([jid, n]) => {
      const name = jid.split('@')[0];
      return `\t*${name}*  ➪  _${n}_`;
    }).join('\n');

    await conn.sendMessage(from, {
      text: `*LIST OF ACTIVE USERS TODAY*\n\n*Total Users: _${sorted.length}_*\n*Total Messages: _${stats.total}_*\n\n*NUMBER 👉 MESSAGE COUNT(s)*\n${listTxt}`
    }, { quoted: mek });
  } catch (e) {
    console.error('messages error:', e);
    reply('❌ Failed to fetch message counts.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CAPTION — Re-send replied media with a new caption
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'caption',
  alias: ['setcaption'],
  desc: 'Set a new caption on a replied image/video/document',
  category: 'misc',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply }) => {
  const ctx = mek.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return reply('*Reply to an image, video, or document with :caption <text>*');
  if (!q) return reply('*Provide a caption!*');

  const quotedMsg  = ctx.quotedMessage;
  const mediaType  = ['imageMessage','videoMessage','documentMessage'].find(t => quotedMsg[t]);
  if (!mediaType)  return reply('*Reply to an image, video, or document.*');

  try {
    const target = { key: { remoteJid: from, id: ctx.stanzaId, participant: ctx.participant }, message: quotedMsg };
    const buffer = await downloadMediaMessage(target, 'buffer', {}, { logger: undefined, reuploadRequest: conn.updateMediaMessage });
    const mime   = quotedMsg[mediaType].mimetype || '';
    const isDoc  = mediaType === 'documentMessage';
    const cap    = isDoc ? q.split('|')[0].trim() : q;
    const fname  = isDoc ? (q.split('|')[1]?.trim() || 'file') : undefined;

    if (mediaType === 'imageMessage')      await conn.sendMessage(from, { image: buffer, caption: cap }, { quoted: mek });
    else if (mediaType === 'videoMessage') await conn.sendMessage(from, { video: buffer, caption: cap, mimetype: mime }, { quoted: mek });
    else await conn.sendMessage(from, { document: buffer, caption: cap, fileName: fname, mimetype: mime }, { quoted: mek });
  } catch (e) {
    console.error('caption error:', e);
    reply('❌ Failed to set caption.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT + TOVV helpers
// ─────────────────────────────────────────────────────────────────────────────
function resolveMedia(mek) {
  const types = ['imageMessage', 'videoMessage'];
  for (const t of types) {
    if (mek.message?.[t]) return { type: t, msg: mek.message[t], source: mek };
  }
  const ctx = mek.message?.extendedTextMessage?.contextInfo;
  if (ctx?.quotedMessage) {
    for (const t of types) {
      if (ctx.quotedMessage[t]) return {
        type: t, msg: ctx.quotedMessage[t],
        source: { key: { remoteJid: mek.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant }, message: ctx.quotedMessage }
      };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT — Send image/video as a document file
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'document',
  alias: ['senddoc', 'todoc'],
  desc: 'Send image/video as a document',
  category: 'misc',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply }) => {
  const media = resolveMedia(mek);
  if (!media) return reply('_Reply to an image or video!_');
  if (!q)     return reply('_Provide a filename. Example: :document photo | caption_');
  try {
    const sep    = q.includes('|') ? '|' : ';';
    const parts  = q.split(sep);
    const ext    = media.type === 'imageMessage' ? 'jpg' : 'mp4';
    const buffer = await downloadMediaMessage(media.source, 'buffer', {}, { logger: undefined, reuploadRequest: conn.updateMediaMessage });
    await conn.sendMessage(from, {
      document: buffer, mimetype: media.msg.mimetype,
      fileName: (parts[0]?.trim() || 'file') + '.' + ext,
      caption: parts[1]?.trim() || ''
    }, { quoted: mek });
  } catch (e) {
    console.error('document error:', e);
    reply('❌ Failed to send as document.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TOVV — Send image/video as view-once
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'tovv',
  alias: ['toviewonce'],
  desc: 'Send image/video as view-once',
  category: 'misc',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply }) => {
  const media = resolveMedia(mek);
  if (!media) return reply('_Reply to an image or video!_');
  try {
    const buffer = await downloadMediaMessage(media.source, 'buffer', {}, { logger: undefined, reuploadRequest: conn.updateMediaMessage });
    const mType  = media.type === 'imageMessage' ? 'image' : 'video';
    await conn.sendMessage(from, {
      [mType]: buffer, caption: q || '',
      mimetype: media.msg.mimetype, viewOnce: true, fileLength: '99999999'
    }, { quoted: mek });
  } catch (e) {
    console.error('tovv error:', e);
    reply('❌ Failed to send as view-once.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CHARACTER — Random character check
// ─────────────────────────────────────────────────────────────────────────────
const CHARS = ['Sigma','Generous','Grumpy','Overconfident','Obedient','Good','Simple','Kind',
  'Patient','Pervert','Cool','Helpful','Brilliant','Sexy','Hot','Gorgeous','Cute','Fabulous','Funny'];

cast({
  pattern: 'character',
  alias: ['char'],
  desc: 'Check the character of a user',
  category: 'misc',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  const ctx    = mek.message?.extendedTextMessage?.contextInfo;
  const target = ctx?.participant || ctx?.mentionedJid?.[0] || null;
  if (!target) return reply('*Mention or reply to a user to check their character!*');
  const char = CHARS[Math.floor(Math.random() * CHARS.length)];
  await conn.sendMessage(from, {
    text: `Character of @${target.split('@')[0]} is *${char}* 🔥⚡`,
    mentions: [target]
  }, { quoted: mek });
});

// ─────────────────────────────────────────────────────────────────────────────
// POETRY — Random shayari
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'poetry',
  alias: ['shairi', 'shayeri'],
  desc: 'Get a random poetry/shayari',
  category: 'misc',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  try {
    const res = await axios.get('https://shizoapi.onrender.com/api/texts/shayari?apikey=shizo', { timeout: 15000 });
    reply(res.data?.result || '_No poetry available right now!_');
  } catch (e) {
    reply('❌ Failed to fetch poetry.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ALEXA — SimSimi AI chat
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'alexa',
  alias: ['simsimi'],
  desc: 'Chat with SimSimi AI',
  category: 'misc',
  filename: __filename,
}, async (conn, mek, m, { from, q, pushname, reply }) => {
  if (!q) return reply(`Hi *${pushname}*, say something!`);
  try {
    const res = await axios.post('https://api.simsimi.vn/v2/simtalk',
      new URLSearchParams({ text: q, lc: 'en', key: '' }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
    );
    reply(res.data?.status === '200' && res.data?.message ? res.data.message : '*No response!*');
  } catch (e) {
    reply('❌ SimSimi failed to respond.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PING2 — Detailed system stats
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

cast({
  pattern: 'ping2',
  alias: ['botstatus', 'statusbot', 'p2'],
  desc: 'Get detailed bot system stats',
  category: 'misc',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  try {
    const mem  = process.memoryUsage();
    const cpus = os.cpus();
    const start = Date.now();
    await conn.sendMessage(from, { react: { text: '⏱️', key: mek.key } });
    const ping = Date.now() - start;
    const nodeMem = Object.entries(mem).map(([k,v]) => `  ${k.padEnd(15)}: ${fmtBytes(v)}`).join('\n');
    await conn.sendMessage(from, { text:
      `⚡ *Response:* ${ping}ms\n⏰ *Uptime:* ${uptime(process.uptime())}\n\n` +
      `🖥️ *Server*\n  RAM: ${fmtBytes(os.totalmem()-os.freemem())} / ${fmtBytes(os.totalmem())}\n` +
      `  CPU: ${cpus[0]?.model?.trim() || 'Unknown'} (${cpus.length} cores)\n  Platform: ${os.platform()} ${os.arch()}\n\n` +
      `🛰️ *Node.js Memory*\n${nodeMem}`
    }, { quoted: mek });
  } catch (e) { reply('❌ Failed to fetch stats.'); }
});

// ─────────────────────────────────────────────────────────────────────────────
// MYIP — Bot's public IP
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'myip',
  alias: ['ip', 'botip'],
  desc: "Get the bot's public IP address",
  category: 'misc',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  try {
    const res = await axios.get('https://api.ipify.org/', { timeout: 10000 });
    reply(res.data ? `*Bot IP:* _${res.data}_` : '_No response from server!_');
  } catch (e) { reply('❌ Failed to fetch IP.'); }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEMPMAIL — Create / check / delete temp email (no cheerio dependency)
// ─────────────────────────────────────────────────────────────────────────────
const mailStore = {};
const MAIL_API  = 'https://www.1secmail.com/api/v1/';

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

cast({
  pattern: 'tempmail',
  alias: ['tmpmail', 'newmail', 'tempemail'],
  desc: 'Create a temporary email address',
  category: 'misc',
  filename: __filename,
}, async (conn, mek, m, { from, sender, reply }) => {
  try {
    if (!mailStore[sender]) {
      const res   = await axios.get(`${MAIL_API}?action=genRandomMailbox&count=1`, { timeout: 15000 });
      const email = res.data?.[0];
      if (!email) return reply('❌ Failed to create temp email.');
      const [login, domain] = email.split('@');
      mailStore[sender] = { email, login, domain };
    }
    const { email, login, domain } = mailStore[sender];
    reply(`📧 *YOUR TEMP EMAIL*\n\n*Email:* ${email}\n*Login:* ${login}\n*Domain:* ${domain}\n\nUse *:checkmail* to read emails\nUse *:delmail* to delete this email`);
  } catch (e) { reply('❌ Failed to create temp email.'); }
});

cast({
  pattern: 'checkmail',
  alias: ['readmail', 'reademail'],
  desc: 'Check your temporary email inbox',
  category: 'misc',
  filename: __filename,
}, async (conn, mek, m, { from, sender, reply }) => {
  try {
    const data = mailStore[sender];
    if (!data) return reply('*No temp email found.* Use *:tempmail* first.');
    const res   = await axios.get(`${MAIL_API}?action=getMessages&login=${data.login}&domain=${data.domain}`, { timeout: 15000 });
    const mails = res.data || [];
    if (!mails.length) return reply('📭 Inbox is empty!');
    for (const mail of mails) {
      const r    = await axios.get(`${MAIL_API}?action=readMessage&login=${data.login}&domain=${data.domain}&id=${mail.id}`, { timeout: 15000 });
      const text = stripHtml(r.data?.htmlBody || r.data?.body || r.data?.textBody || '(empty)');
      await conn.sendMessage(from, {
        text: `📨 *Email*\n\n*From:* ${mail.from}\n*Date:* ${mail.date}\n*Subject:* ${mail.subject}\n\n*Content:*\n${text.slice(0, 1500)}`
      }, { quoted: mek });
    }
  } catch (e) { reply('❌ Failed to check emails.'); }
});

cast({
  pattern: 'delmail',
  alias: ['deletemail', 'deltemp', 'deltmp'],
  desc: 'Delete your temporary email',
  category: 'misc',
  filename: __filename,
}, async (conn, mek, m, { from, sender, reply }) => {
  if (mailStore[sender]) { delete mailStore[sender]; reply('✅ Temp email deleted.'); }
  else reply('*No temp email to delete.*');
});

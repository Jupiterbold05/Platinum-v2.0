// plugins/converters.js
// Commands: circle, round, wallpaper, memegen, emix, quotely,
//           ebinary, dbinary, qr, paste, photo, toaudio, voice, tomp4, ttp
'use strict';
const { makeSmartQuote } = require('../cast');

const path  = require('path');
const fs    = require('fs');
const axios    = require('axios');
const FormData = require('form-data');
const fetch = require('node-fetch');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { cast }   = require('../cast');
const config     = require('../config');
const { StickerTypes, Sticker } = require('wa-sticker-formatter');

const TEMP = path.join(__dirname, '../temp');

// ── Get quoted message context (works correctly in this framework) ─────────────
function getQuotedCtx(mek) {
  return mek.message?.extendedTextMessage?.contextInfo
      || mek.message?.imageMessage?.contextInfo
      || mek.message?.videoMessage?.contextInfo
      || mek.message?.audioMessage?.contextInfo
      || mek.message?.stickerMessage?.contextInfo
      || null;
}

// ── Download quoted media via Baileys downloadMediaMessage ────────────────────
async function downloadQuoted(conn, mek, allowedTypes) {
  // Check if the message itself is the media (sent directly, not as reply)
  const selfType = Object.keys(mek.message || {}).find(k => allowedTypes.some(t => k === t));
  if (selfType) {
    return downloadMediaMessage(mek, 'buffer', {}, {
      logger: undefined, reuploadRequest: conn.updateMediaMessage
    });
  }

  // Get quoted
  const ctx = getQuotedCtx(mek);
  if (!ctx?.quotedMessage) return null;

  const qType = Object.keys(ctx.quotedMessage).find(k => allowedTypes.some(t => k === t));
  if (!qType) return null;

  const target = {
    key: {
      remoteJid: mek.key.remoteJid,
      id:        ctx.stanzaId,
      participant: ctx.participant,
    },
    message: ctx.quotedMessage,
  };
  return downloadMediaMessage(target, 'buffer', {}, {
    logger: undefined, reuploadRequest: conn.updateMediaMessage
  });
}

// Check if quoted message has a specific type
function quotedHasType(mek, allowedTypes) {
  const selfType = Object.keys(mek.message || {}).find(k => allowedTypes.some(t => k === t));
  if (selfType) return true;
  const ctx = getQuotedCtx(mek);
  if (!ctx?.quotedMessage) return false;
  return !!Object.keys(ctx.quotedMessage).find(k => allowedTypes.some(t => k === t));
}

// ── Sticker sender ────────────────────────────────────────────────────────────
async function sendSticker(conn, mek, from, buffer, opts = {}) {
  const sticker = new Sticker(buffer, {
    pack:    config.PACK_NAME    || config.PACKNAME || 'NEXUS-MD',
    author:  config.STICKER_NAME || config.AUTHOR   || 'cylee',
    type:    StickerTypes.FULL,
    quality: 50,
    ...opts,
  });
  await conn.sendMessage(from, { sticker: await sticker.toBuffer() }, { quoted: mek });
}

// ─────────────────────────────────────────────────────────────────────────────
// STICKER VARIANTS
// ─────────────────────────────────────────────────────────────────────────────

const IMG_VID = ['imageMessage', 'videoMessage', 'stickerMessage'];
const IMG_ONLY = ['imageMessage', 'stickerMessage'];

cast({
  pattern:  'circle',
  alias:    ['circlestic', 'circlesticker', 'cs'],
  desc:     'Circle sticker from image',
  category: 'converter',
  use:      '(reply to image)',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  try {
    if (!quotedHasType(mek, IMG_VID)) return reply('*_Reply to an image!_*');
    const buf = await downloadQuoted(conn, mek, IMG_VID);
    if (!buf) return reply('*_Could not download media!_*');
    await sendSticker(conn, mek, from, buf, { type: StickerTypes.CIRCLE, quality: 50 });
  } catch (e) { reply('Error: ' + e.message); }
});

cast({
  pattern:  'round',
  alias:    ['roundstic', 'roundsticker'],
  desc:     'Rounded sticker from image',
  category: 'converter',
  use:      '(reply to image)',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  try {
    if (!quotedHasType(mek, IMG_VID)) return reply('*_Reply to an image!_*');
    const buf = await downloadQuoted(conn, mek, IMG_VID);
    if (!buf) return reply('*_Could not download media!_*');
    await sendSticker(conn, mek, from, buf, { type: StickerTypes.ROUNDED, quality: 50 });
  } catch (e) { reply('Error: ' + e.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// WALLPAPER
// ─────────────────────────────────────────────────────────────────────────────

cast({
  pattern:  'wallpaper',
  desc:     'Get a random wallpaper',
  category: 'converter',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  try {
    const res  = await fetch('https://api.unsplash.com/photos/random?client_id=72utkjatCBC-PDcx7-Kcvgod7-QOFAm2fXwEeW8b8cc');
    const data = await res.json();
    const url  = data?.urls?.regular;
    if (!url) return reply('*_Could not fetch wallpaper, try again!_*');
    await conn.sendMessage(from, { image: { url }, caption: '*--- Random Wallpaper ---*' }, { quoted: mek });
  } catch (e) { reply('Error: ' + e.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// MEMEGEN
// ─────────────────────────────────────────────────────────────────────────────

cast({
  pattern:  'memegen',
  desc:     'Write text on quoted image → meme sticker',
  category: 'converter',
  use:      '<top text>;<bottom text> (reply to image)',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    if (!q) return reply('*Provide text!*\nExample: :memegen Hello;World');
    if (!quotedHasType(mek, IMG_ONLY)) return reply('*Reply to an image!*');

    const [textPart, outputType = 'sticker'] = q.split('|');
    const [top = '_', bottom = '_'] = textPart.split(';');

    const imgBuf = await downloadQuoted(conn, mek, IMG_ONLY);
    if (!imgBuf) return reply('*_Could not download image!_*');

    // Use sharp to overlay meme text directly on the image — no external upload needed
    const sharp = require('sharp');
    const meta  = await sharp(imgBuf).metadata();
    const W = meta.width  || 800;
    const H = meta.height || 600;

    // Build SVG text overlay (top + bottom impact-style text)
    function memeTextSvg(text, y, fontSize, height) {
      if (!text || text === '_') return '';
      const lines = text.toUpperCase().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      return `<text
        x="${W/2}" y="${y}"
        font-family="Impact, Arial Black, sans-serif"
        font-size="${fontSize}" font-weight="bold"
        fill="white" stroke="black" stroke-width="${Math.max(2, fontSize/14)}"
        text-anchor="middle" dominant-baseline="auto"
        paint-order="stroke fill"
      >${lines}</text>`;
    }

    const fontSize = Math.max(32, Math.round(W / 12));
    const padding  = Math.round(fontSize * 0.9);

    const svgOverlay = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      ${memeTextSvg(top,    padding + fontSize * 0.8, fontSize, H)}
      ${memeTextSvg(bottom, H - Math.round(padding * 0.4), fontSize, H)}
    </svg>`;

    const memeBuf = await sharp(imgBuf)
      .resize({ width: Math.min(W, 800), withoutEnlargement: true })
      .composite([{ input: Buffer.from(svgOverlay), gravity: 'northwest' }])
      .jpeg({ quality: 88 })
      .toBuffer();

    if (outputType.trim().startsWith('p')) {
      await conn.sendMessage(from, { image: memeBuf, caption: config.CAPTION || config.BOT_NAME || '' }, { quoted: mek });
      return;
    }
    await sendSticker(conn, mek, from, memeBuf, { type: StickerTypes.FULL, quality: 70 });
  } catch (e) { reply('Error: ' + e.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// EMIX
// ─────────────────────────────────────────────────────────────────────────────

cast({
  pattern:  'emix',
  desc:     'Mix two emojis into a sticker',
  category: 'converter',
  use:      '<emoji1>,<emoji2>',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    const [e1, e2] = (q || '').split(',').map(s => s.trim());
    if (!e1 || !e2) return reply('*Example:* :emix 😅,🤔');
    const res  = await fetch(
      `https://tenor.googleapis.com/v2/featured?key=AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ&contentfilter=high&media_filter=png_transparent&component=proactive&collection=emoji_kitchen_v5&q=${e1}_${e2}`
    );
    const data = await res.json();
    if (!data?.results?.[0]?.url) return reply("*_Can't mix those emojis, try different ones_*");
    const buf = await (await fetch(data.results[0].url)).buffer();
    await sendSticker(conn, mek, from, buf, { type: StickerTypes.FULL, quality: 70 });
  } catch (e) { reply('Error: ' + e.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// QUOTELY
// ─────────────────────────────────────────────────────────────────────────────

cast({
  pattern:  'quotely',
  alias:    ['q'],
  desc:     'Make a quote sticker from a replied message',
  category: 'converter',
  use:      '(reply to message) [white|black]',
  filename: __filename,
}, async (conn, mek, m, { from, sender, q, reply }) => {
  try {
    const ctx = getQuotedCtx(mek);
    const text = ctx?.quotedMessage?.conversation
              || ctx?.quotedMessage?.extendedTextMessage?.text
              || q;

    if (!ctx || !text) return reply('*_Reply to a message!_*');

    const quotedSender = ctx.participant || ctx.remoteJid || sender;
    let ppUrl = '';
    try { ppUrl = await conn.profilePictureUrl(quotedSender, 'image'); } catch {}

    const bg   = q === 'white' ? '#FFFFFF' : q === 'black' ? '#000000'
               : ['#FFFFFF', '#000000'][Math.floor(Math.random() * 2)];
    const name = quotedSender.split('@')[0];

    const payload = {
      type: 'quote', format: 'png',
      backgroundColor: bg,
      width: 512, height: 512, scale: 3,
      messages: [{
        avatar: true,
        from: { first_name: name, language_code: 'en', name, photo: { url: ppUrl } },
        text,
        replyMessage: {}
      }]
    };

    const res = await axios.post('https://bot.lyo.su/quote/generate', payload);
    if (!res?.data?.ok) return reply("*_Can't create quote sticker!_*");

    const buf = Buffer.alloc(res.data.result.image.length, res.data.result.image, 'base64');
    await sendSticker(conn, mek, from, buf, { type: StickerTypes.FULL, quality: 70 });
  } catch (e) { reply('Error: ' + e.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONVERTERS
// ─────────────────────────────────────────────────────────────────────────────

cast({
  pattern:  'ebinary',
  desc:     'Encode text to binary',
  category: 'converter',
  use:      '<text>',
  filename: __filename,
}, async (conn, mek, m, { q, reply }) => {
  try {
    const ctx  = getQuotedCtx(mek);
    const text = q || ctx?.quotedMessage?.conversation || ctx?.quotedMessage?.extendedTextMessage?.text;
    if (!text) return reply('*_Provide text to encode!_*');
    reply(text.split('').map(c => c.charCodeAt(0).toString(2)).join(' '));
  } catch (e) { reply('Error: ' + e.message); }
});

cast({
  pattern:  'dbinary',
  desc:     'Decode binary to text',
  category: 'converter',
  use:      '<binary>',
  filename: __filename,
}, async (conn, mek, m, { q, reply }) => {
  try {
    const ctx  = getQuotedCtx(mek);
    const text = q || ctx?.quotedMessage?.conversation || ctx?.quotedMessage?.extendedTextMessage?.text;
    if (!text) return reply('*_Provide binary to decode!_*');
    reply(text.split(' ').map(b => String.fromCharCode(parseInt(b, 2))).join(''));
  } catch (e) { reply('Error: ' + e.message); }
});

cast({
  pattern:  'qr',
  desc:     'Generate a QR code from text',
  category: 'converter',
  use:      '<text>',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    if (!q) return reply('*Provide text to generate QR!*');
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(q)}`;
    await conn.sendMessage(from, { image: { url }, caption: '*_Scan QR to get your text_*' }, { quoted: mek });
  } catch (e) { reply('Error: ' + e.message); }
});

cast({
  pattern:  'paste',
  desc:     'Create a telegraph paste from text',
  category: 'converter',
  use:      '<text>',
  filename: __filename,
}, async (conn, mek, m, { q, reply }) => {
  try {
    const ctx  = getQuotedCtx(mek);
    const text = q || ctx?.quotedMessage?.conversation || ctx?.quotedMessage?.extendedTextMessage?.text;
    if (!text) return reply('*Provide text to paste!*');
    const { data } = await axios.get(
      `https://api.telegra.ph/createPage?access_token=d3b25feccb89e508a9114afb82aa421fe2a9712b963b387cc5ad71e58722&title=NEXUS-MD+Bot&author_name=nexus&content=[{"tag":"p","children":["${text.replace(/ /g, '+')}"]}]&return_content=true`
    );
    reply(`*Paste created!*\n*Title:* ${data.result.title}\n*URL:* ${data.result.url}`);
  } catch (e) { reply('Error: ' + e.message); }
});

cast({
  pattern:  'photo',
  alias:    ['stickertoimg', 'sticker2img'],
  desc:     'Convert a sticker to an image',
  category: 'converter',
  use:      '(reply to sticker)',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  try {
    if (!quotedHasType(mek, IMG_ONLY)) return reply('*_Reply to a sticker or image!_*');
    const buf = await downloadQuoted(conn, mek, IMG_ONLY);
    if (!buf) return reply('*_Could not download media!_*');
    await conn.sendMessage(from, { image: buf, mimetype: 'image/jpeg' }, { quoted: mek });
  } catch (e) { reply('Error: ' + e.message); }
});

const AUD_VID = ['audioMessage', 'videoMessage'];

cast({
  pattern:  'toaudio',
  alias:    ['mp3', 'tomp3'],
  desc:     'Convert video to audio',
  category: 'converter',
  use:      '(reply to video)',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  try {
    if (!quotedHasType(mek, AUD_VID)) return reply('*_Reply to a video!_*');
    const buf = await downloadQuoted(conn, mek, AUD_VID);
    if (!buf) return reply('*_Could not download media!_*');
    const { toAudio } = require('../lib');
    const audio = await toAudio(buf);
    await conn.sendMessage(from, { audio, mimetype: 'audio/mpeg' }, { quoted: mek });
  } catch (e) { reply('Error: ' + e.message); }
});

cast({
  pattern:  'voice',
  alias:    ['ptt', 'toptt'],
  desc:     'Send audio/video as a voice note',
  category: 'converter',
  use:      '(reply to audio/video)',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  try {
    if (!quotedHasType(mek, AUD_VID)) return reply('*_Reply to audio or video!_*');
    const buf = await downloadQuoted(conn, mek, AUD_VID);
    if (!buf) return reply('*_Could not download media!_*');
    await conn.sendMessage(from, { audio: buf, mimetype: 'audio/mpeg', ptt: true }, { quoted: mek });
  } catch (e) { reply('Error: ' + e.message); }
});

cast({
  pattern:  'tomp4',
  alias:    ['mp4', 'tovideo'],
  desc:     'Convert animated sticker/gif to mp4',
  category: 'converter',
  use:      '(reply to animated sticker or gif)',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  try {
    const VID_WEBP = ['videoMessage', 'stickerMessage'];
    if (!quotedHasType(mek, VID_WEBP)) return reply('*_Reply to an animated sticker or gif!_*');
    const buf = await downloadQuoted(conn, mek, VID_WEBP);
    if (!buf) return reply('*_Could not download media!_*');

    fs.mkdirSync(TEMP, { recursive: true });
    const tmpFile = path.join(TEMP, `tomp4_${Date.now()}.webp`);
    fs.writeFileSync(tmpFile, buf);

    let outFile = tmpFile;
    try {
      const { webp2mp4File } = require('../lib');
      const result = await webp2mp4File(tmpFile);
      outFile = result.result;
    } catch {}

    await conn.sendMessage(from, { video: { url: outFile }, caption: config.CAPTION || '' }, { quoted: mek });
    try { fs.unlinkSync(tmpFile); if (outFile !== tmpFile) fs.unlinkSync(outFile); } catch {}
  } catch (e) { reply('Error: ' + e.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// TTP — text to sticker via canvas
// ─────────────────────────────────────────────────────────────────────────────

cast({
  pattern:  'ttp',
  desc:     'Convert text to a sticker',
  category: 'converter',
  use:      '<text>',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    const ctx  = getQuotedCtx(mek);
    const text = q || ctx?.quotedMessage?.conversation || ctx?.quotedMessage?.extendedTextMessage?.text;
    if (!text) return reply('*_Provide text!_*\nExample: :ttp Hello World');

    const { createCanvas } = require('canvas');
    fs.mkdirSync(TEMP, { recursive: true });
    const outFile = path.join(TEMP, `ttp_${Date.now()}.png`);

    const W = 300, H = 300;
    const canvas = createCanvas(W, H);
    const ctx2   = canvas.getContext('2d');
    ctx2.clearRect(0, 0, W, H);
    ctx2.font      = '22px Arial';
    ctx2.fillStyle = 'black';
    ctx2.textAlign = 'center';

    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx2.measureText(test).width <= W - 20) { line = test; }
      else { if (line) lines.push(line); line = word; }
    }
    if (line) lines.push(line);

    const lineH  = 25;
    const startY = (H - lines.length * lineH) / 2;
    lines.forEach((l, i) => ctx2.fillText(l, W / 2, startY + i * lineH));

    await new Promise((res, rej) => {
      const stream = canvas.createPNGStream();
      const out    = fs.createWriteStream(outFile);
      stream.pipe(out);
      out.on('finish', res);
      out.on('error', rej);
    });

    const buf = fs.readFileSync(outFile);
    try { fs.unlinkSync(outFile); } catch {}
    await sendSticker(conn, mek, from, buf, { type: StickerTypes.ROUNDED, quality: 50 });
  } catch (e) { reply('Error: ' + e.message); }
});

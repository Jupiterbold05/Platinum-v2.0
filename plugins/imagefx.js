// plugins/imagefx.js — Image effects via popcat.xyz
// Commands: beautiful, blur, facepalm, invert, rainbow, wanted, wasted,
//           greyscale, sepia, rip, trash, hitler, jail, shit, affect,
//           ad, uncover, clown, mnm, pet, drip, gun, colorify + editor (all at once)
'use strict';
const { cast, makeSmartQuote, applyFont } = require('../cast');

const fs     = require('fs');
const path   = require('path');
const axios  = require('axios');
const FormData = require('form-data');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const config  = require('../config');

const TEMP = path.join(__dirname, '../temp');

const EFFECTS = [
  'beautiful', 'blur', 'facepalm', 'invert', 'rainbow',
  'wanted', 'wasted', 'greyscale', 'sepia', 'rip',
  'trash', 'hitler', 'jail', 'shit', 'affect',
  'ad', 'uncover', 'clown', 'mnm', 'pet', 'drip', 'gun', 'colorify'
];

// ── Upload image buffer to catbox.moe, return public URL ────────────────────
async function uploadToTelegraph(buffer) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('userhash', '');
  form.append('fileToUpload', buffer, { filename: 'img.jpg' });
  const res = await axios.post('https://catbox.moe/user/api.php', form, {
    headers: form.getHeaders(),
    timeout: 60000
  });
  if (!res.data || !res.data.startsWith('https')) throw new Error('Upload failed');
  return res.data.trim();
}

// ── Download quoted or self image ─────────────────────────────────────────────
function getQuotedCtx(mek) {
  return mek.message?.extendedTextMessage?.contextInfo
      || mek.message?.imageMessage?.contextInfo
      || null;
}

async function downloadImage(conn, mek) {
  // Direct image
  if (mek.message?.imageMessage) {
    return downloadMediaMessage(mek, 'buffer', {}, {
      logger: undefined, reuploadRequest: conn.updateMediaMessage
    });
  }
  // Quoted image
  const ctx = getQuotedCtx(mek);
  if (ctx?.quotedMessage?.imageMessage) {
    const target = {
      key: { remoteJid: mek.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant },
      message: ctx.quotedMessage,
    };
    return downloadMediaMessage(target, 'buffer', {}, {
      logger: undefined, reuploadRequest: conn.updateMediaMessage
    });
  }
  return null;
}

// ── Apply a single effect and send ───────────────────────────────────────────
async function applyEffect(conn, mek, from, effect, imageUrl) {
  const res = await axios.get(`https://api.popcat.xyz/${effect}?image=${encodeURIComponent(imageUrl)}`, {
    responseType: 'arraybuffer',
    timeout: 30000
  });
  const buf = Buffer.from(res.data);
  await conn.sendMessage(from, { image: buf, caption: `_${effect}_` }, { quoted: mek });
}

// ── Register one command per effect ──────────────────────────────────────────
for (const effect of EFFECTS) {
  cast({
    pattern:  effect,
    desc:     `Apply ${effect} effect to an image`,
    category: 'editor',
    use:      '(reply to image)',
    filename: __filename,
  }, async (conn, mek, m, { from, reply }) => {
    try {
      const buf = await downloadImage(conn, mek);
      if (!buf) return reply('*_Reply to an image!_*');

      await reply(`_Applying *${effect}* effect..._`);
      const url = await uploadToTelegraph(buf);
      await applyEffect(conn, mek, from, effect, url);
    } catch (e) { reply('Error: ' + e.message); }
  });
}

// ── EDITOR — apply ALL effects at once ───────────────────────────────────────
cast({
  pattern:  'editor',
  desc:     'Apply all image effects at once (reply to image)',
  category: 'editor',
  use:      '(reply to image)',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  try {
    const buf = await downloadImage(conn, mek);
    if (!buf) {
      // Show menu if no image
      return reply(
        `┌───〈 *IMAGE EDITOR MENU* 〉\n` +
        `│\n` +
        `│ ${EFFECTS.join('\n│ ')}\n` +
        `│\n` +
        `└── Reply to an image with :editor\n` +
        `_Or use individual effect commands_`
      );
    }

    await reply(`_Applying all ${EFFECTS.length} effects... this will take a moment 🎨_`);
    const url = await uploadToTelegraph(buf);

    for (const effect of EFFECTS) {
      try {
        await applyEffect(conn, mek, from, effect, url);
        await new Promise(r => setTimeout(r, 800)); // avoid rate limiting
      } catch { /* skip failed effects silently */ }
    }
  } catch (e) { reply('Error: ' + e.message); }
});

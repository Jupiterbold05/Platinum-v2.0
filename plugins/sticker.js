'use strict';

const { cast, makeSmartQuote, applyFont } = require('../cast');

const config = require('../config');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { writeExifImg, writeExifVid } = require('../lib/exifUtils');
const { downloadMediaMessage }       = require('@whiskeysockets/baileys');
const { getTempDir, deleteTempFile } = require('../lib/tempManager');

const ffmpegPath = require('ffmpeg-static');

const webp      = require('node-webpmux');

const { exec }  = require('child_process');

const { webp2png, webp2mp4 } = require('../lib/webp2mp4');

// ── STICKER — sticker ─────────────────────────────────

cast({
  pattern: 'sticker',
  alias: ['s', 'stiker', 'stc'],
  desc: 'Convert image or video to sticker',
  category: 'sticker',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  let tempFiles = [];
  try {
    let target = mek;
    const ctx = mek.message?.extendedTextMessage?.contextInfo;
    if (ctx?.quotedMessage) {
      target = { key: { remoteJid: from, id: ctx.stanzaId, participant: ctx.participant }, message: ctx.quotedMessage };
    }

    const mediaMsg = target.message?.imageMessage || target.message?.videoMessage || target.message?.documentMessage;
    if (!mediaMsg) return reply('📎 Reply to an *image* or *video* with :sticker, or send media with :sticker as caption.');

    const buf = await downloadMediaMessage(target, 'buffer', {}, { logger: undefined, reuploadRequest: conn.updateMediaMessage });
    if (!buf) return reply('❌ Failed to download media.');
    if (buf.length > 50 * 1024 * 1024) return reply('❌ File too large (max 50MB).');

    const dir   = getTempDir();
    const ts    = Date.now();
    const inp   = path.join(dir, `stk_in_${ts}`);
    const outp  = path.join(dir, `stk_out_${ts}.webp`);
    tempFiles   = [inp, outp];

    fs.writeFileSync(inp, buf);

    const isAnim = mediaMsg.mimetype?.includes('gif') || mediaMsg.mimetype?.includes('video') || (mediaMsg.seconds || 0) > 0;
    const baseCmd = isAnim
      ? `"${ffmpegPath}" -i "${inp}" -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 75 -compression_level 6 "${outp}"`
      : `"${ffmpegPath}" -i "${inp}" -vf "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 75 -compression_level 6 "${outp}"`;

    const run = cmd => new Promise((res, rej) => exec(cmd, e => e ? rej(e) : res()));
    await run(baseCmd);

    let webpBuf = fs.readFileSync(outp);

    // Fallback compression if animated sticker is too large
    if (isAnim && webpBuf.length > 1000 * 1024) {
      const outp2 = path.join(dir, `stk_fb_${ts}.webp`);
      tempFiles.push(outp2);
      const isLarge = buf.length > 5 * 1024 * 1024;
      const fbCmd = isLarge
        ? `"${ffmpegPath}" -y -i "${inp}" -t 2 -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=8,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 30 -compression_level 6 -b:v 100k "${outp2}"`
        : `"${ffmpegPath}" -y -i "${inp}" -t 3 -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=12,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 45 -compression_level 6 -b:v 150k "${outp2}"`;
      await run(fbCmd);
      if (fs.existsSync(outp2)) webpBuf = fs.readFileSync(outp2);
    }

    // Add EXIF metadata
    const img = new webp.Image();
    await img.load(webpBuf);
    const json       = { 'sticker-pack-id': crypto.randomBytes(32).toString('hex'), 'sticker-pack-name': config.BOT_NAME || 'NEXUS-MD', emojis: ['🤖'] };
    const exifAttr   = Buffer.from([0x49,0x49,0x2a,0x00,0x08,0x00,0x00,0x00,0x01,0x00,0x41,0x57,0x07,0x00,0x00,0x00,0x00,0x00,0x16,0x00,0x00,0x00]);
    const jsonBuf    = Buffer.from(JSON.stringify(json), 'utf8');
    const exif       = Buffer.concat([exifAttr, jsonBuf]);
    exif.writeUIntLE(jsonBuf.length, 14, 4);
    img.exif = exif;

    await conn.sendMessage(from, { sticker: await img.save(null) }, { quoted: mek });
  } catch (e) {
    console.error('sticker error:', e);
    reply('❌ Failed to create sticker.');
  } finally {
    tempFiles.forEach(deleteTempFile);
  }
});

// ── ANIMATED TEXT STICKER — attp ──────────────────────

cast({
  pattern: 'attp',
  desc: 'Create animated blinking text sticker',
  category: 'sticker',
  filename: __filename,
}, async (conn, mek, m, { args, from, reply }) => {
  const text = args.join(' ').trim();
  if (!text) return reply('❌ Provide text!\nExample: :attp Hello World');
  if (text.length > 50) return reply('❌ Max 50 characters.');

  try {
    const mp4Buffer  = await renderBlinkingVideo(text);
    const webpBuffer = await writeExifVid(mp4Buffer, { packname: config.STICKER_PACK || 'NEXUS-MD' });
    await conn.sendMessage(from, { sticker: webpBuffer }, { quoted: mek });
  } catch (e) {
    console.error('attp error:', e.message);
    reply('❌ Failed to generate animated sticker: ' + e.message);
  }
});

function escapeDrawtext(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/%/g, '\\%');
}

function renderBlinkingVideo(text) {
  return new Promise((resolve, reject) => {
    const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
    const safe = escapeDrawtext(text);
    const dur  = 1.8;
    const cycle = 0.3;

    // Build three drawtext filters: red blinks, then blue, then green
    const base = `fontfile='${font}':text='${safe}':borderw=2:bordercolor=black@0.6:fontsize=56:x=(w-text_w)/2:y=(h-text_h)/2`;
    const red   = `drawtext=${base}:fontcolor=red:enable='lt(mod(t,${cycle}),0.1)'`;
    const blue  = `drawtext=${base}:fontcolor=blue:enable='between(mod(t,${cycle}),0.1,0.2)'`;
    const green = `drawtext=${base}:fontcolor=green:enable='gte(mod(t,${cycle}),0.2)'`;
    const filter = `${red},${blue},${green}`;

    const ff = spawn('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=black:s=512x512:d=${dur}:r=20`,
      '-vf', filter,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart+frag_keyframe+empty_moov',
      '-t', String(dur),
      '-f', 'mp4',
      'pipe:1'
    ]);

    const chunks = [], errs = [];
    ff.stdout.on('data', d => chunks.push(d));
    ff.stderr.on('data', e => errs.push(e));
    ff.on('error', err => reject(new Error('ffmpeg not found: ' + err.message)));
    ff.on('close', code => {
      if (code === 0) return resolve(Buffer.concat(chunks));
      reject(new Error(Buffer.concat(errs).toString().slice(-300)));
    });
  });
}

// ── TAKE STICKER — take ───────────────────────────────

cast({
  pattern: 'take',
  alias: ['steal'],
  desc: 'Steal a sticker and change its packname',
  category: 'sticker',
  filename: __filename,
}, async (conn, mek, m, { from, sender, args, reply }) => {
  try {
    let target = mek;
    const ctx = mek.message?.extendedTextMessage?.contextInfo;
    if (ctx?.quotedMessage) {
      target = { key: { remoteJid: from, id: ctx.stanzaId, participant: ctx.participant }, message: ctx.quotedMessage };
    }

    if (!target.message?.stickerMessage) return reply('🎭 Reply to a *sticker* with :take to steal it.');

    const buf = await downloadMediaMessage(target, 'buffer', {}, { logger: undefined, reuploadRequest: conn.updateMediaMessage });
    if (!buf) return reply('❌ Failed to download sticker.');

    const packname   = args.length ? args.join(' ') : (mek.pushName || sender.split('@')[0]);
    const img        = new webp.Image();
    await img.load(buf);

    const json       = { 'sticker-pack-id': crypto.randomBytes(32).toString('hex'), 'sticker-pack-name': packname, emojis: ['🤖'] };
    const exifAttr   = Buffer.from([0x49,0x49,0x2a,0x00,0x08,0x00,0x00,0x00,0x01,0x00,0x41,0x57,0x07,0x00,0x00,0x00,0x00,0x00,0x16,0x00,0x00,0x00]);
    const jsonBuf    = Buffer.from(JSON.stringify(json), 'utf8');
    const exif       = Buffer.concat([exifAttr, jsonBuf]);
    exif.writeUIntLE(jsonBuf.length, 14, 4);
    img.exif = exif;

    await conn.sendMessage(from, { sticker: await img.save(null) }, { quoted: mek });
  } catch (e) {
    console.error('take error:', e);
    reply('❌ Failed to steal sticker.');
  }
});

// ── STICKER TO IMAGE — simage ─────────────────────────

cast({
  pattern: 'simage',
  alias: ['toimg', 'svideo'],
  desc: 'Convert sticker to image (static) or video (animated)',
  category: 'sticker',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  try {
    const ctx = mek.message?.extendedTextMessage?.contextInfo;
    if (!ctx?.quotedMessage) return reply('📎 Reply to a sticker to convert it.');

    const target = { key: { remoteJid: from, id: ctx.stanzaId, participant: ctx.participant }, message: ctx.quotedMessage };
    if (!target.message?.stickerMessage) return reply('📎 Reply to a *sticker* to convert it.');

    const buf = await downloadMediaMessage(target, 'buffer', {}, { logger: undefined, reuploadRequest: conn.updateMediaMessage });
    if (!buf) return reply('❌ Failed to download sticker.');

    const isAnimated = target.message.stickerMessage.isAnimated;

    if (isAnimated) {
      const mp4 = await webp2mp4(buf);
      await conn.sendMessage(from, { video: mp4, mimetype: 'video/mp4', gifPlayback: true }, { quoted: mek });
    } else {
      const img = await webp2png(buf);
      await conn.sendMessage(from, { image: img }, { quoted: mek });
    }
  } catch (e) {
    console.error('simage error:', e);
    reply(`❌ Failed to convert sticker: ${e.message}`);
  }
});

// ── CROP STICKER — crop ───────────────────────────────

cast({
  pattern: 'crop',
  alias: ['square', 'cropper'],
  desc: 'Crop sticker/image/video to a perfect square sticker',
  category: 'sticker',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  const tmpDir     = getTempDir();
  const tempInput  = path.join(tmpDir, `crop_in_${Date.now()}`);
  const tempOutput = path.join(tmpDir, `crop_out_${Date.now()}.webp`);

  try {
    // Resolve target message (direct or quoted)
    let targetMessage = mek;
    const ctxInfo = mek.message?.extendedTextMessage?.contextInfo;
    if (ctxInfo?.quotedMessage) {
      targetMessage = { key: { remoteJid: from, id: ctxInfo.stanzaId, participant: ctxInfo.participant }, message: ctxInfo.quotedMessage };
    }

    const msgTypes = ['imageMessage', 'stickerMessage', 'videoMessage', 'documentMessage'];
    const msgType  = msgTypes.find(t => targetMessage.message?.[t]);
    if (!msgType) return reply('✂️ Reply to a *sticker*, *image*, or *video* to crop it.');

    const mediaMsg  = targetMessage.message[msgType];
    const mediaBuf  = await downloadMediaMessage(targetMessage, 'buffer', {}, { logger: undefined, reuploadRequest: conn.updateMediaMessage });
    if (!mediaBuf) return reply('❌ Failed to download media.');
    if (mediaBuf.length > 50 * 1024 * 1024) return reply('❌ File too large (max 50MB).');

    fs.writeFileSync(tempInput, mediaBuf);

    const isAnimated = mediaMsg.mimetype?.includes('gif') || mediaMsg.mimetype?.includes('video') || (mediaMsg.seconds || 0) > 0 || msgType === 'videoMessage';
    const isLarge    = mediaBuf.length > 5 * 1024 * 1024;

    let cmd;
    if (isAnimated) {
      cmd = isLarge
        ? `ffmpeg -i "${tempInput}" -t 2 -vf "crop=min(iw\\,ih):min(iw\\,ih),scale=512:512,fps=8" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 30 -compression_level 6 -b:v 100k "${tempOutput}"`
        : `ffmpeg -i "${tempInput}" -t 3 -vf "crop=min(iw\\,ih):min(iw\\,ih),scale=512:512,fps=12" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 50 -compression_level 6 -b:v 150k "${tempOutput}"`;
    } else {
      cmd = `ffmpeg -i "${tempInput}" -vf "crop=min(iw\\,ih):min(iw\\,ih),scale=512:512,format=rgba" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 75 -compression_level 6 "${tempOutput}"`;
    }

    await new Promise((res, rej) => exec(cmd, e => e ? rej(e) : res()));

    let webpBuffer = fs.readFileSync(tempOutput);
    const img = new webp.Image();
    await img.load(webpBuffer);

    const json       = { 'sticker-pack-id': crypto.randomBytes(32).toString('hex'), 'sticker-pack-name': config.BOT_NAME || 'NEXUS-MD', emojis: ['✂️'] };
    const exifAttr   = Buffer.from([0x49,0x49,0x2a,0x00,0x08,0x00,0x00,0x00,0x01,0x00,0x41,0x57,0x07,0x00,0x00,0x00,0x00,0x00,0x16,0x00,0x00,0x00]);
    const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
    const exif       = Buffer.concat([exifAttr, jsonBuffer]);
    exif.writeUIntLE(jsonBuffer.length, 14, 4);
    img.exif = exif;

    const final = await img.save(null);
    await conn.sendMessage(from, { sticker: final }, { quoted: mek });
  } catch (e) {
    console.error('crop error:', e);
    reply('❌ Failed to crop. Try with an image or video.');
  } finally {
    deleteTempFile(tempInput);
    deleteTempFile(tempOutput);
  }
});

'use strict';
const config = require('../config');
// lib/exifUtils.js — EXIF metadata helpers for stickers
'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const webp   = require('node-webpmux');
const { getTempDir, deleteTempFile } = require('./tempManager');

async function writeExifImg(imgBuffer, metadata = {}) {
  const imgWebp = new webp.Image();
  await imgWebp.load(imgBuffer);
  imgWebp.exif = buildExif(metadata.packname);
  return await imgWebp.save(null);
}

async function writeExifVid(videoBuffer, metadata = {}) {
  const ffmpegPath = require('ffmpeg-static');
  const { spawn }  = require('child_process');
  const tempDir    = getTempDir();
  const inputPath  = path.join(tempDir, `ev_in_${Date.now()}.mp4`);
  const outputPath = path.join(tempDir, `ev_out_${Date.now()}.webp`);
  fs.writeFileSync(inputPath, videoBuffer);
  try {
    await new Promise((resolve, reject) => {
      const ff = spawn(ffmpegPath, [
        '-y', '-i', inputPath,
        '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000',
        '-c:v', 'libwebp', '-preset', 'default', '-loop', '0', '-vsync', '0',
        '-pix_fmt', 'yuva420p', '-quality', '75', '-compression_level', '6',
        outputPath
      ]);
      const errs = [];
      ff.stderr.on('data', d => errs.push(d));
      ff.on('error', reject);
      ff.on('close', code => code === 0 ? resolve() : reject(new Error(Buffer.concat(errs).toString())));
    });
    const webpBuf  = fs.readFileSync(outputPath);
    const imgWebp  = new webp.Image();
    await imgWebp.load(webpBuf);
    imgWebp.exif = buildExif(metadata.packname);
    return await imgWebp.save(null);
  } finally {
    deleteTempFile(inputPath);
    deleteTempFile(outputPath);
  }
}

function buildExif(packname = config.STICKER_PACK || 'NEXUS-MD', author = config.STICKER_AUTHOR || 'nexus') {
  const json       = { 'sticker-pack-id': crypto.randomBytes(32).toString('hex'), 'sticker-pack-name': packname, emojis: ['🤖'] };
  const exifAttr   = Buffer.from([0x49,0x49,0x2a,0x00,0x08,0x00,0x00,0x00,0x01,0x00,0x41,0x57,0x07,0x00,0x00,0x00,0x00,0x00,0x16,0x00,0x00,0x00]);
  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
  const exif       = Buffer.concat([exifAttr, jsonBuffer]);
  exif.writeUIntLE(jsonBuffer.length, 14, 4);
  return exif;
}

module.exports = { writeExifImg, writeExifVid, buildExif };

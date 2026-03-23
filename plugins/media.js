'use strict';

const { cast, makeSmartQuote, applyFont } = require('../cast');

const config = require('../config');
const ffmpeg     = require('fluent-ffmpeg');
const { writeExifVid } = require('../lib/exifUtils');

const fs        = require('fs');

const path      = require('path');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { exec }  = require('child_process');

// ── AUDIO EFFECTS ─────────────────────────────────────

// ── ffmpeg filter map ─────────────────────────────────────────────────────────
const FILTERS = {
  bass:      '-af equalizer=f=54:width_type=o:width=2:g=20',
  blown:     '-af acrusher=.1:1:64:0:log',
  deep:      '-af atempo=4/4,asetrate=44500*2/3',
  earrape:   '-af volume=12',
  fast:      '-filter:a "atempo=1.63,asetrate=44100"',
  fat:       '-filter:a "atempo=1.6,asetrate=22100"',
  nightcore: '-filter:a atempo=1.06,asetrate=44100*1.25',
  reverse:   '-filter_complex "areverse"',
  robot:     '-filter_complex "afftfilt=real=\'hypot(re,im)*sin(0)\':imag=\'hypot(re,im)*cos(0)\':win_size=512:overlap=0.75"',
  slow:      '-filter:a "atempo=0.7,asetrate=44100"',
  smooth:    '-filter:v "minterpolate=\'mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=120\'"',
  tupai:     '-filter:a "atempo=0.5,asetrate=65100"',
};

// ── shared audio editor ───────────────────────────────────────────────────────
async function audioEditor(conn, mek, m, { from, reply }, effect) {
  // Resolve quoted audio
  const ctx = mek.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return reply('*Reply to an audio or voice note!* 👸❤️');

  const audioType = ['audioMessage'].find(t => ctx.quotedMessage[t]);
  if (!audioType) return reply('*Reply to an audio message!*');

  const filter  = FILTERS[effect];
  const tmpDir  = path.join(process.env.TMPDIR || '/tmp');
  const inFile  = path.join(tmpDir, `ae_in_${Date.now()}.mp3`);
  const outFile = path.join(tmpDir, `ae_out_${Date.now()}_${effect}.mp3`);

  try {
    await reply(`_Processing ${effect} effect... 🎵_`);

    // Download audio
    const target = {
      key: { remoteJid: from, id: ctx.stanzaId, participant: ctx.participant },
      message: ctx.quotedMessage
    };
    const buffer = await downloadMediaMessage(target, 'buffer', {}, {
      logger: undefined, reuploadRequest: conn.updateMediaMessage
    });
    fs.writeFileSync(inFile, buffer);

    // Run ffmpeg
    await new Promise((resolve, reject) => {
      exec(`"${ffmpeg}" -y -i "${inFile}" ${filter} "${outFile}"`, (err) => {
        try { fs.unlinkSync(inFile); } catch {}
        if (err) return reject(err);
        resolve();
      });
    });

    const audioBuffer = fs.readFileSync(outFile);
    try { fs.unlinkSync(outFile); } catch {}

    await conn.sendMessage(from, {
      audio: audioBuffer,
      mimetype: 'audio/mpeg',
      ptt: false,
    }, { quoted: mek });

  } catch (e) {
    try { fs.unlinkSync(inFile);  } catch {}
    try { fs.unlinkSync(outFile); } catch {}
    console.error(`audioeffects [${effect}] error:`, e.message);
    reply(`❌ Failed to apply ${effect} effect: ${e.message}`);
  }
}

// ── Register all 12 commands ──────────────────────────────────────────────────
const effects = Object.keys(FILTERS);

for (const effect of effects) {
  cast({
    pattern: effect,
    desc: `Apply ${effect} effect to an audio`,
    category: 'media',
    use: '<reply to audio>',
    filename: __filename,
  }, async (conn, mek, m, ctx) => {
    await audioEditor(conn, mek, m, ctx, effect);
  });
}

// ── VIDEO/IMAGE/AUDIO FILTERS — waves/frequency/mp4reverse etc 

const caption = `_${config.BOT_NAME || 'NEXUS-MD'}_`;
const tmpDir  = './temp';
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

// ── helper: get media buffer from quoted message via m.quoted.getbuff ─
const getMediaBuf = async (m) => {
  if (!m.quoted) return null;
  try { return await m.quoted.getbuff; } catch {}
  try { return await m.quoted.download(); } catch {}
  return null;
};

// ── helper: ffmpeg promise wrapper ────────────────────────────────────
const ffmpegRun = (input, outputPath, args = []) =>
  new Promise((resolve, reject) => {
    let ff = ffmpeg(input);
    if (args.length) ff = ff.outputOptions(args);
    ff.save(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject);
  });

// ── video filters ─────────────────────────────────────────────────────
const videoFxCmd = (pattern, desc, filters) => {
  cast({ pattern, desc, category: 'media', filename: __filename },
  async (conn, mek, m, { from, reply }) => {
    try {
      if (!m.quoted) return reply('*Reply to a video!*');
      const buf = await getMediaBuf(m);
      if (!buf) return reply('*Could not download the media. Reply to a video!*');
      const inputPath  = `${tmpDir}/input_${Date.now()}.mp4`;
      const outputPath = `${tmpDir}/${pattern}_${Date.now()}.mp4`;
      fs.writeFileSync(inputPath, buf);
      await ffmpegRun(inputPath, outputPath, filters);
      await conn.sendMessage(from, { video: fs.readFileSync(outputPath), caption }, { quoted: mek });
      try { fs.unlinkSync(inputPath); fs.unlinkSync(outputPath); } catch {}
    } catch (e) { reply(`❌ Error: ${e.message}`); }
  });
};

// ── audio filters ─────────────────────────────────────────────────────
const audioFxCmd = (pattern, desc, filters) => {
  cast({ pattern, desc, category: 'media', filename: __filename },
  async (conn, mek, m, { from, reply }) => {
    try {
      if (!m.quoted) return reply('*Reply to an audio!*');
      const buf = await getMediaBuf(m);
      if (!buf) return reply('*Could not download the media. Reply to an audio!*');
      const inputPath  = `${tmpDir}/input_${Date.now()}.mp3`;
      const outputPath = `${tmpDir}/${pattern}_${Date.now()}.mp3`;
      fs.writeFileSync(inputPath, buf);
      await ffmpegRun(inputPath, outputPath, filters);
      await conn.sendMessage(from, { audio: fs.readFileSync(outputPath), mimetype: 'audio/mpeg', ptt: false }, { quoted: mek });
      try { fs.unlinkSync(inputPath); fs.unlinkSync(outputPath); } catch {}
    } catch (e) { reply(`❌ Error: ${e.message}`); }
  });
};

// ── image filters ─────────────────────────────────────────────────────
const imageFxCmd = (pattern, desc, filters) => {
  cast({ pattern, desc, category: 'media', filename: __filename },
  async (conn, mek, m, { from, reply }) => {
    try {
      if (!m.quoted) return reply('*Reply to an image!*');
      const buf = await getMediaBuf(m);
      if (!buf) return reply('*Could not download the media. Reply to an image!*');
      const inputPath  = `${tmpDir}/input_${Date.now()}.jpg`;
      const outputPath = `${tmpDir}/${pattern}_${Date.now()}.png`;
      fs.writeFileSync(inputPath, buf);
      await ffmpegRun(inputPath, outputPath, filters);
      await conn.sendMessage(from, { image: fs.readFileSync(outputPath), caption }, { quoted: mek });
      try { fs.unlinkSync(inputPath); fs.unlinkSync(outputPath); } catch {}
    } catch (e) { reply(`❌ Error: ${e.message}`); }
  });
};

// ── video commands ────────────────────────────────────────────────────
videoFxCmd('x4mp4',      'Compress video to 25% size',              ['-y', '-vf', 'scale=iw/4:ih/4']);
videoFxCmd('x2mp4',      'Compress video to 50% size',              ['-y', '-vf', 'scale=iw/2:ih/2']);
videoFxCmd('mp4vintage', 'Add vintage effect to video',             ['-y', '-vf', 'curves=vintage,format=yuv420p']);
videoFxCmd('mp4reverse', 'Reverse a video',                         ['-y', '-vf', 'reverse', '-af', 'areverse']);
videoFxCmd('mp4bw',      'Black & white video',                     ['-y', '-vf', 'hue=s=0']);
videoFxCmd('mp4enhance', 'Sharpen/enhance video quality',           ['-y', '-vf', 'unsharp=3:3:1.5']);
videoFxCmd('mp4blur',    'Blur background behind video',            ['-y', '-vf', 'split[original][copy];[copy]scale=ih*16/9:-1,crop=h=iw*9/16,gblur=sigma=20[blurred];[blurred][original]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2']);
videoFxCmd('mp4edge',    'Edge detect video',                       ['-y', '-codec:v', 'mpeg4', '-filter:v', 'edgedetect=low=0.9:high=0.3']);
videoFxCmd('mp4color',   'Enhance video colors',                    ['-y', '-vf', 'eq=contrast=1.3:saturation=1.5:brightness=-0.1,format=yuv420p']);
videoFxCmd('mp4negative','Invert video colors',                     ['-y', '-vf', 'curves=color_negative,format=yuv420p']);
videoFxCmd('mp4stab',    'Stabilize shaky video',                   ['-y', '-vf', 'deshake,format=yuv420p']);
videoFxCmd('mp4art',     'Artistic convolution effect',             ['-y', '-vf', 'convolution=-2 -1 0 -1 1 1 0 1 2:-2 -1 0 -1 1 1 0 1 2:-2 -1 0 -1 1 1 0 1 2:-2 -1 0 -1 1 1 0 1 2,format=yuv420p']);
videoFxCmd('gif2',       'Convert video to GIF-style (no audio)',   ['-y', '-vf', 'fps=13', '-an']);
videoFxCmd('mp4slowmo',  'Slow-motion video (4x slower)',           ['-y', '-vf', 'setpts=4*PTS']);

// ── audio waveform/spectrum visualisers ───────────────────────────────
cast({ pattern: 'waves', desc: 'Audio waveform visualizer video', category: 'media', filename: __filename },
async (conn, mek, m, { from, reply }) => {
  try {
    if (!m.quoted) return reply('*Reply to an audio!*');
    const buf = await getMediaBuf(m);
    if (!buf) return reply('*Could not download the audio.*');
    const inp = `${tmpDir}/inp_${Date.now()}.mp3`;
    const out = `${tmpDir}/waves_${Date.now()}.mp4`;
    fs.writeFileSync(inp, buf);
    await ffmpegRun(inp, out, ['-y', '-filter_complex', '[0:a]showwaves=s=720x1280:mode=cline:rate=25,format=yuv420p[v]', '-map', '[v]', '-map', '0:a']);
    await conn.sendMessage(from, { video: fs.readFileSync(out), caption }, { quoted: mek });
    try { fs.unlinkSync(inp); fs.unlinkSync(out); } catch {}
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

cast({ pattern: 'frequency', desc: 'Audio frequency visualizer video', category: 'media', filename: __filename },
async (conn, mek, m, { from, reply }) => {
  try {
    if (!m.quoted) return reply('*Reply to an audio!*');
    const buf = await getMediaBuf(m);
    if (!buf) return reply('*Could not download the audio.*');
    const inp = `${tmpDir}/inp_${Date.now()}.mp3`;
    const out = `${tmpDir}/freq_${Date.now()}.mp4`;
    fs.writeFileSync(inp, buf);
    await ffmpegRun(inp, out, ['-y', '-filter_complex', '[0:a]showfreqs=s=720x1280:mode=cline:fscale=log,format=yuv420p[v]', '-map', '[v]', '-map', '0:a']);
    await conn.sendMessage(from, { video: fs.readFileSync(out), caption }, { quoted: mek });
    try { fs.unlinkSync(inp); fs.unlinkSync(out); } catch {}
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── audio transform commands ──────────────────────────────────────────
audioFxCmd('mp3volume',  'Boost audio volume 5x',      ['-y', '-filter:a', 'volume=5.3']);
audioFxCmd('mp3reverse', 'Reverse audio',               ['-y', '-filter_complex', 'areverse']);
audioFxCmd('x2mp3',     'Double-speed audio',           ['-y', '-filter:a', 'atempo=2.0', '-vn']);
audioFxCmd('mp3low',    'Lower audio pitch',            ['-y', '-af', 'asetrate=44100*0.9']);
audioFxCmd('mp3pitch',  'Raise audio pitch',            ['-y', '-af', 'asetrate=44100*1.3']);
audioFxCmd('mp3crusher','Bit crusher audio effect',     ['-y', '-filter_complex', 'acrusher=level_in=8:level_out=18:bits=8:mode=log:aa=1']);
audioFxCmd('mp3bass',   'Boost bass frequencies',       ['-y', '-filter:a', 'bass=g=9:f=110:w=0.6']);

// ── image fx commands ─────────────────────────────────────────────────
imageFxCmd('bwimage',       'Black & white image',         ['-y', '-vf', 'hue=s=0']);
imageFxCmd('vintageimage',  'Vintage image filter',         ['-y', '-vf', 'curves=vintage']);
imageFxCmd('edgeimage',     'Edge-detect image',            ['-y', '-filter:v', 'edgedetect=low=0.9:high=0.2']);
imageFxCmd('enhanceimage',  'Sharpen image quality',        ['-y', '-vf', 'unsharp=3:3:1.5']);
imageFxCmd('artimage',      'Artistic convolution image',   ['-y', '-vf', 'convolution=-2 -1 0 -1 1 1 0 1 2:-2 -1 0 -1 1 1 0 1 2:-2 -1 0 -1 1 1 0 1 2:-2 -1 0 -1 1 1 0 1 2']);
imageFxCmd('colorimage',    'Enhanced color image',         ['-y', '-vf', 'eq=contrast=1.3:saturation=1.5:brightness=-0.1']);
imageFxCmd('negativeimage', 'Negative/inverted image',      ['-y', '-vf', 'curves=color_negative']);
imageFxCmd('grenimage',     'Grain noise image',            ['-y', '-vf', 'noise=alls=100:allf=t+u']);
imageFxCmd('blurimage',     'Blur background of image',     ['-y', '-vf', 'split[original][copy];[copy]scale=ih*16/9:-1,crop=h=iw*9/16,gblur=sigma=20[blurred];[blurred][original]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2']);
imageFxCmd('rainbowimage',  'Rainbow color image',          ['-y', '-vf', "geq=r='X/W*r(X,Y)':g='(1-X/W)*g(X,Y)':b='(H-Y)/H*b(X,Y)'", '-vf', 'eq=brightness=0.6']);

// ── mp4image: image → looping video ──────────────────────────────────
cast({ pattern: 'mp4image', desc: 'Convert image to short looping video', category: 'media', filename: __filename },
async (conn, mek, m, { from, reply }) => {
  try {
    if (!m.quoted) return reply('*Reply to an image!*');
    const buf = await getMediaBuf(m);
    if (!buf) return reply('*Could not download the image.*');
    const inp = `${tmpDir}/inp_${Date.now()}.jpg`;
    const out = `${tmpDir}/mp4img_${Date.now()}.mp4`;
    fs.writeFileSync(inp, buf);
    await new Promise((res, rej) =>
      ffmpeg(inp).loop(6).fps(19).videoBitrate(400).size('640x480').format('mp4').save(out)
        .on('end', res).on('error', rej)
    );
    await conn.sendMessage(from, { video: fs.readFileSync(out), caption }, { quoted: mek });
    try { fs.unlinkSync(inp); fs.unlinkSync(out); } catch {}
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

'use strict';

const { cast, makeSmartQuote, applyFont } = require('../cast');

const config = require('../config');
const axios   = require('axios');
const yts     = require('yt-search');
const fs      = require('fs');
const path    = require('path');

// ── DOWNLOADERS — tt/igdl/xdl/pindl/spdl/facebook/scdl 

// ════════════════════════════════════════════════════════════════════
// SETUP & CONSTANTS
// ════════════════════════════════════════════════════════════════════

// Ensure temp dir exists
const tmpDir = path.join(__dirname, '../temp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const BOT = () => config.BOT_NAME || 'PLATINUM V2';

const FB_PATTERNS = [
  /https?:\/\/(?:www\.|m\.)?facebook\.com\//,
  /https?:\/\/(?:www\.|m\.)?fb\.com\//,
  /https?:\/\/fb\.watch\//,
  /https?:\/\/(?:www\.)?facebook\.com\/watch/,
  /https?:\/\/(?:www\.)?facebook\.com\/.*\/videos\//,
  /https?:\/\/(?:www\.)?facebook\.com\/reel\//,
  /https?:\/\/(?:www\.)?facebook\.com\/share\//,
];

const EMOJIS = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣'];

// ════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════════

// Unified davidxtech response extractor
function extractLinks(data) {
  const links = [];
  const root  = data?.data || data?.result || data;

  // { hd, sd }
  if (root?.hd) links.push({ quality: 'HD', url: root.hd });
  if (root?.sd) links.push({ quality: 'SD', url: root.sd });

  // { url }
  if (!links.length && root?.url) links.push({ quality: 'SD', url: root.url });

  // { links/videos/medias/result: [...] }
  const arr = root?.links || root?.videos || root?.medias || root?.media || root?.items || root?.result || data?.result;
  if (Array.isArray(arr)) {
    for (const item of arr) {
      const url = item?.url || item?.download || item?.src || item?.link;
      if (!url) continue;
      const q = String(item?.quality || item?.type || item?.resolution || 'SD').toUpperCase();
      links.push({ quality: q.includes('HD') || q.includes('720') || q.includes('1080') ? 'HD' : 'SD', url });
    }
  }

  // { thumb, video } shape (some Pinterest)
  if (!links.length && root?.video) links.push({ quality: 'SD', url: root.video });

  return links;
}

async function sendVideo(conn, from, mek, videoUrl, caption) {
  try {
    await conn.sendMessage(from, { video: { url: videoUrl }, mimetype: 'video/mp4', caption }, { quoted: mek });
  } catch {
    const buf = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      timeout: 90000,
      maxContentLength: 150 * 1024 * 1024,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }).then(r => Buffer.from(r.data));
    await conn.sendMessage(from, { video: buf, mimetype: 'video/mp4', caption }, { quoted: mek });
  }
}

async function sendImage(conn, from, mek, imageUrl, caption) {
  try {
    await conn.sendMessage(from, { image: { url: imageUrl }, caption }, { quoted: mek });
  } catch {
    const buf = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }).then(r => Buffer.from(r.data));
    await conn.sendMessage(from, { image: buf, caption }, { quoted: mek });
  }
}

function isValidFbUrl(url) {
  return FB_PATTERNS.some(p => p.test(url));
}

function fmtNum(n) {
  if (!n) return '?';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function getField(obj, ...keys) {
  for (const k of keys) {
    const val = k.split('.').reduce((o, p) => o?.[p], obj);
    if (val !== undefined && val !== null && val !== '') return val;
  }
  return null;
}

async function downloadByUrl(videoUrl) {
  const res = await axios.get(
    `https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`,
    { timeout: 30000 }
  );
  const d = res.data?.data;
  if (!d?.play) throw new Error('Could not get download link');
  return d;
}

// ════════════════════════════════════════════════════════════════════
// COMMANDS
// ════════════════════════════════════════════════════════════════════

// ── 0. TIKTOK DOWNLOADER ────────────────────────────────────────────

// ── YOUTUBE AUDIO — play ──────────────────────────────

cast({
    pattern: "play",
    desc: "Downloads audio from YouTube (Stream Direct)",
    category: 'downloader',
    filename: __filename,
    use: "<search text>"
},
// PERFECT MATCH WITH AI FILE:
async (conn, mek, m, { from, q, reply, react }) => { 
    try {
        if (!q) return reply("*_Give me a search query_*");

        // await react("📥");

        // Search for the video
        let searchResults = await yts(q);
        let video = searchResults.all[0];

        if (!video) {
           // await react("❌");
            return reply("*_No results found for your search_*");
        }

        // Send video details
        await conn.sendMessage(from, { 
            image: { url: video.thumbnail },
            caption: `\n*🎵 NEXUS-MD-V1 Music Downloader 🎵*\n\n*🎧 Title:* ${video.title}\n*🔗 URL:* ${video.url}\n*⏳ Duration:* ${video.timestamp}\n*🎙️ Author:* ${video.author.name}\n\n_🎶 Fetching high-quality audio..._`
        }, { quoted: mek });

        const videoUrl = encodeURIComponent(video.url);
        let downloadUrl = null;

        try {
            // PRIMARY API
            const primaryApi = `https://api.giftedtech.co.ke/api/download/ytmp3?apikey=gifted&url=${videoUrl}&quality=128kbps`;
            const { data: primaryData } = await axios.get(primaryApi);

            if (primaryData.success && primaryData.result.download_url) {
                downloadUrl = primaryData.result.download_url;
            } else {
                throw new Error("Primary API failed");
            }
        } catch (e) {
            console.log("Primary API failed, trying fallback...");
            // FALLBACK API
            const fallbackApi = `https://api.giftedtech.co.ke/api/download/savetubemp3?apikey=gifted&url=${videoUrl}`;
            const { data: fallbackData } = await axios.get(fallbackApi);

            if (fallbackData.success && fallbackData.result.download_url) {
                downloadUrl = fallbackData.result.download_url;
            }
        }

        if (!downloadUrl) {
            //await react("❌");
            return reply("*_Failed to generate a download link. Please try again later._*");
        }

        // Send the audio file DIRECTLY from the URL
        await conn.sendMessage(from, {
            audio: { url: downloadUrl },
            fileName: `${video.title}.mp3`,
            mimetype: "audio/mpeg"
        }, { quoted: mek });

       // await react("✅");

    } catch (error) {
        console.error("Caught Error:", error);
        //await react("❌");
        return reply("*_Error: Could not process your request!!_*");
    }
});

// ── YOUTUBE VIDEO — video ─────────────────────────────

// ── Multi-API YouTube downloaders ─────────────────────────────────────
// Each returns a URL string or null. They are tried in order until one works.

async function getAudioUrl(videoUrl) {
  const encodedUrl = encodeURIComponent(videoUrl);

  // API 1: giftedtech ytmp3
  try {
    const r = await axios.get(
      `https://api.giftedtech.co.ke/api/download/ytmp3?apikey=gifted&url=${encodedUrl}&quality=128kbps`,
      { timeout: 20000 }
    );
    if (r.data?.success && r.data?.result?.download_url) return r.data.result.download_url;
  } catch {}

  // API 2: giftedtech savetubemp3
  try {
    const r = await axios.get(
      `https://api.giftedtech.co.ke/api/download/savetubemp3?apikey=gifted&url=${encodedUrl}`,
      { timeout: 20000 }
    );
    if (r.data?.success && r.data?.result?.download_url) return r.data.result.download_url;
  } catch {}

  // API 3: giftedtechnexus
  try {
    const r = await axios.get(
      `https://api.giftedtechnexus.co.ke/api/download/ytmp3?apikey=gifteddevskk&url=${encodedUrl}`,
      { timeout: 20000 }
    );
    if (r.data?.success && r.data?.result?.download_url) return r.data.result.download_url;
  } catch {}

  // API 4: cobalt (open source, no key)
  try {
    const r = await axios.post(
      'https://cobalt-api.kwiatekkamilek.pl/',
      { url: videoUrl, isAudioOnly: true, aFormat: 'mp3' },
      { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    if (r.data?.url) return r.data.url;
  } catch {}

  return null;
}

async function getVideoUrl(videoUrl) {
  const encodedUrl = encodeURIComponent(videoUrl);

  // API 1: giftedtech savetubemp4
  try {
    const r = await axios.get(
      `https://api.giftedtech.co.ke/api/download/savetubemp4?apikey=gifted&url=${encodedUrl}`,
      { timeout: 20000 }
    );
    if (r.data?.success && r.data?.result?.download_url) return r.data.result.download_url;
  } catch {}

  // API 2: giftedtech ytmp4
  try {
    const r = await axios.get(
      `https://api.giftedtech.co.ke/api/download/ytmp4?apikey=gifted&url=${encodedUrl}&quality=720p`,
      { timeout: 20000 }
    );
    if (r.data?.success && r.data?.result?.download_url) return r.data.result.download_url;
  } catch {}

  // API 3: giftedtechnexus
  try {
    const r = await axios.get(
      `https://api.giftedtechnexus.co.ke/api/download/ytmp4?apikey=gifteddevskk&url=${encodedUrl}`,
      { timeout: 20000 }
    );
    if (r.data?.success && r.data?.result?.download_url) return r.data.result.download_url;
  } catch {}

  // API 4: cobalt (open source, no key)
  try {
    const r = await axios.post(
      'https://cobalt-api.kwiatekkamilek.pl/',
      { url: videoUrl, vQuality: '720' },
      { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    if (r.data?.url) return r.data.url;
  } catch {}

  // API 5: y2mate-style API (no key)
  try {
    const r = await axios.get(
      `https://api.vevioz.com/@api/button/mp4/720/${encodedUrl}`,
      { timeout: 20000 }
    );
    const url = r.data?.url || r.data?.dlink || r.data?.link;
    if (url) return url;
  } catch {}

  return null;
}

// ── Command ───────────────────────────────────────────────────────────
cast({
  pattern:  'video',
  alias:    ['video2', 'play2', 'yt'],
  desc:     'Download YouTube audio or video — reply with 1 or 2',
  category: 'downloader',
  filename: __filename
},
async (conn, mek, m, { from, q, reply }) => {
  try {
    if (!q) return reply('❌ Please provide a search query or YouTube URL!');

    // Search YouTube
    const search = await yts(q);
    const video  = search.videos[0];
    if (!video) return reply('❌ No results found!');

    const videoUrl = video.url;
    const infoText =
      `*🎵 YT DOWNLOADER 🎵*\n\n` +
      `*📝 Title:* ${video.title}\n` +
      `*⏳ Duration:* ${video.timestamp}\n` +
      `*👁️ Views:* ${Number(video.views || 0).toLocaleString()}\n\n` +
      `*Reply with a number:*\n` +
      `1️⃣ *Audio (MP3)*\n` +
      `2️⃣ *Video (MP4)*\n\n` +
      `_I am waiting for your reply..._`;

    // Send the menu card
    const sentMsg = await conn.sendMessage(from, {
      image:   { url: video.thumbnail },
      caption: infoText
    }, { quoted: mek });

    const messageId = sentMsg.key.id;

    // ── Listener ──────────────────────────────────────────────────────
    const handler = async (update) => {
      const msg = update.messages[0];
      if (!msg?.message) return;
      if (msg.key.remoteJid !== from) return;

      // Skip the menu card we just sent (by its known ID)
      // ⚠️ DO NOT check msg.key.fromMe — owner-as-bot sends fromMe=true for their own replies
      if (msg.key.id === messageId) return;

      // Extract text from any message type
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        '';

      // Must be a reply to our menu card
      const ctx =
        msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.imageMessage?.contextInfo        ||
        msg.message?.videoMessage?.contextInfo        ||
        null;

      if (!ctx || ctx.stanzaId !== messageId) return;
      if (text !== '1' && text !== '2') return;

      // Kill listener — one response per menu
      conn.ev.off('messages.upsert', handler);
      clearTimeout(killTimer);

      if (text === '1') {
        await conn.sendMessage(from, { react: { text: '⏳', key: msg.key } });
        await conn.sendMessage(from, { text: '🎧 Fetching audio...' }, { quoted: msg });

        const audioUrl = await getAudioUrl(videoUrl);

        if (audioUrl) {
          await conn.sendMessage(from, {
            audio:    { url: audioUrl },
            mimetype: 'audio/mpeg',
            fileName: `${video.title}.mp3`,
            ptt:      false
          }, { quoted: msg });
          await conn.sendMessage(from, { react: { text: '✅', key: msg.key } });
        } else {
          await conn.sendMessage(from, { react: { text: '❌', key: msg.key } });
          reply('❌ All audio APIs failed. Try again later.');
        }

      } else if (text === '2') {
        await conn.sendMessage(from, { react: { text: '⏳', key: msg.key } });
        await conn.sendMessage(from, { text: '🎬 Fetching video...' }, { quoted: msg });

        const videoDownloadUrl = await getVideoUrl(videoUrl);

        if (videoDownloadUrl) {
          await conn.sendMessage(from, {
            video:    { url: videoDownloadUrl },
            mimetype: 'video/mp4',
            caption:  `🎵 *${video.title}*\n_${config.BOT_NAME || 'NEXUS-MD'}_`
          }, { quoted: msg });
          await conn.sendMessage(from, { react: { text: '✅', key: msg.key } });
        } else {
          await conn.sendMessage(from, { react: { text: '❌', key: msg.key } });
          reply('❌ All video APIs failed. Try again or use a shorter video.');
        }
      }
    };

    conn.ev.on('messages.upsert', handler);

    // Auto-kill after 5 minutes
    const killTimer = setTimeout(() => {
      conn.ev.off('messages.upsert', handler);
    }, 300000);

  } catch (error) {
    console.error('[video]', error);
    reply('❌ An error occurred. Try again.');
  }
});

// ── TIKTOK SEARCH — ttsearch ──────────────────────────

const EMOJIS_1 = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣'];

function fmtNum(n) {
  if (!n) return '?';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function getField(obj, ...keys) {
  for (const k of keys) {
    const val = k.split('.').reduce((o, p) => o?.[p], obj);
    if (val !== undefined && val !== null && val !== '') return val;
  }
  return null;
}

async function downloadByUrl(videoUrl) {
  const res = await axios.get(
    `https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`,
    { timeout: 30000 }
  );
  const d = res.data?.data;
  if (!d?.play) throw new Error('Could not get download link');
  return d;
}

cast({
  pattern:  'ttsearch',
  alias:    ['tiktoksearch', 'searchtt'],
  desc:     'Search TikTok — sends thumbnail previews, just reply to any one to download',
  category: 'downloader',
  react:    '🔍',
  filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
  if (!q) return reply(
    `🎵 *TikTok Search*\n\n` +
    `*Usage:* ttsearch <keyword>\n` +
    `*Example:* ttsearch afrobeats 2025\n\n` +
    `_Bot will send previews — just reply to any one to download it._`
  );

  await conn.sendMessage(from, { react: { text: '⏳', key: mek.key } });

  let items = [];

  try {
    const res = await axios.get(
      `https://meta.davidxtech.de/api/tiktokv2/search?q=${encodeURIComponent(q)}`,
      { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const raw  = res.data;
    const list =
      raw?.data?.videos || raw?.data?.items || raw?.results ||
      raw?.items || (Array.isArray(raw?.data) ? raw.data : null) ||
      (Array.isArray(raw) ? raw : null);

    if (Array.isArray(list) && list.length) {
      items = list.slice(0, 5).map(v => ({
        title:    getField(v, 'desc', 'title', 'video_description', 'caption') || 'No title',
        author:   getField(v, 'author.unique_id', 'author.nickname', 'username', 'author_name') || 'unknown',
        likes:    getField(v, 'digg_count', 'statistics.diggCount', 'like_count'),
        plays:    getField(v, 'play_count', 'statistics.playCount', 'view_count'),
        duration: getField(v, 'duration'),
        cover:    getField(v, 'cover', 'origin_cover', 'thumbnail', 'cover_image_url', 'video.cover'),
        url:      getField(v, 'share_url', 'url', 'video_url',
                    v.id || v.aweme_id
                      ? `https://www.tiktok.com/@${getField(v, 'author.unique_id', 'username') || 'user'}/video/${v.id || v.aweme_id}`
                      : null),
      })).filter(v => v.url);
    }
  } catch (e) {
    console.error('[ttsearch] davidxtech error:', e.message);
  }

  if (!items.length) {
    try {
      const res = await axios.get(
        `https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(q)}&count=5&cursor=0`,
        { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const list = res.data?.data?.videos || res.data?.data || [];
      if (Array.isArray(list) && list.length) {
        items = list.slice(0, 5).map(v => ({
          title:    v.title || v.desc || 'No title',
          author:   v.author?.unique_id || v.author?.nickname || 'unknown',
          likes:    v.digg_count,
          plays:    v.play_count,
          duration: v.duration,
          cover:    v.cover || v.origin_cover,
          url:      `https://www.tiktok.com/@${v.author?.unique_id || 'user'}/video/${v.video_id || v.id}`,
        }));
      }
    } catch (e2) {
      console.error('[ttsearch] tikwm fallback error:', e2.message);
    }
  }

  if (!items.length) {
    await conn.sendMessage(from, { react: { text: '❌', key: mek.key } });
    return reply(`❌ No results found for *"${q}"*.\nTry a different keyword.`);
  }

  // ── Send preview cards ────────────────────────────────────────────
  const sentIds = new Map(); // messageId → item index

  await conn.sendMessage(from, {
    text: `🔍 *TikTok: "${q}"* — ${items.length} results\n_↩️ Reply to any preview below to download it_`
  }, { quoted: mek });

  for (let i = 0; i < items.length; i++) {
    const v   = items[i];
    const dur = v.duration
      ? `⏱ ${Math.floor(v.duration / 60)}:${String(v.duration % 60).padStart(2, '0')}`
      : '';

    const caption =
      `${EMOJIS[i]} *${v.title.length > 80 ? v.title.substring(0, 77) + '...' : v.title}*\n\n` +
      `👤 @${v.author}\n` +
      [dur, v.likes ? `❤️ ${fmtNum(v.likes)}` : '', v.plays ? `▶️ ${fmtNum(v.plays)}` : '']
        .filter(Boolean).join('  ') +
      `\n\n_↩️ Reply to download this video_`;

    try {
      const sent = v.cover
        ? await conn.sendMessage(from, { image: { url: v.cover }, caption }, { quoted: mek })
        : await conn.sendMessage(from, { text: caption }, { quoted: mek });
      if (sent?.key?.id) sentIds.set(sent.key.id, i);
    } catch (e) {
      console.error(`[ttsearch] send preview ${i + 1} error:`, e.message);
    }
  }

  await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });

  // ── Listener ──────────────────────────────────────────────────────
  const handler = async ({ messages }) => {
    const msg = messages[0];

    // Must have a message and be in the same chat
    if (!msg?.message) return;
    if (msg.key.remoteJid !== from) return;

    // Skip the bot's own outgoing messages by their known IDs
    // ⚠️ DO NOT check msg.key.fromMe here — when the owner IS the bot number,
    // their reply arrives with fromMe=true and would get incorrectly skipped
    if (sentIds.has(msg.key.id)) return;

    // Must be a reply (contextInfo.stanzaId) pointing to one of our cards
    // Check all possible message types that can carry a reply
    const ctx =
      msg.message?.extendedTextMessage?.contextInfo ||
      msg.message?.imageMessage?.contextInfo        ||
      msg.message?.videoMessage?.contextInfo        ||
      msg.message?.audioMessage?.contextInfo        ||
      msg.message?.stickerMessage?.contextInfo      ||
      null;

    const stanzaId = ctx?.stanzaId;
    if (!stanzaId || !sentIds.has(stanzaId)) return;

    // Matched — stop listening and download
    conn.ev.off('messages.upsert', handler);
    clearTimeout(killTimer);

    const video = items[sentIds.get(stanzaId)];

    await conn.sendMessage(from, {
      text: `⏳ Downloading *${video.title.substring(0, 50)}...*`
    }, { quoted: msg });

    try {
      const d = await downloadByUrl(video.url);

      const caption =
        `🎵 *${video.title.substring(0, 80)}${video.title.length > 80 ? '...' : ''}*\n\n` +
        `👤 @${video.author}\n` +
        (d.duration ? `⏱ ${Math.floor(d.duration / 60)}:${String(d.duration % 60).padStart(2, '0')}\n` : '') +
        (d.digg_count ? `❤️ ${fmtNum(d.digg_count)}\n` : '') +
        `\n_${config.BOT_NAME || 'NEXUS-MD'}_`;

      await conn.sendMessage(from, {
        video:    { url: d.play },
        mimetype: 'video/mp4',
        caption
      }, { quoted: msg });

    } catch (e) {
      console.error('[ttsearch] download error:', e.message);
      await conn.sendMessage(from, {
        text: `❌ Download failed: ${e.message}\nSearch again with *ttsearch*.`
      }, { quoted: msg });
    }
  };

  conn.ev.on('messages.upsert', handler);

  const killTimer = setTimeout(() => {
    conn.ev.off('messages.upsert', handler);
  }, 5 * 60 * 1000);
});

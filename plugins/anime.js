'use strict';

const { cast, makeSmartQuote, applyFont } = require('../cast');

const config = require('../config');
const axios = require('axios');
const fetch = require('node-fetch');

// ── WAIFU ─────────────────────────────────────────────

const BASE = "https://api.princetechn.com/api/anime/waifu";

const API_KEY = "prince";

cast({

    pattern: "waifu",

    alias: ["waifusfw"],

    desc: "Get random waifu SFW anime images",

    category: 'anime',

    filename: __filename

}, async (conn, mek, m, {

    from,

    reply

}) => {

    try {

        await conn.sendMessage(from, {

            react: { text: "🌸", key: mek.key }

        });

        const url = `${BASE}?apikey=${API_KEY}`;

        const response = await axios.get(url, {

            headers: {

                "User-Agent": "Mozilla/5.0",

                "Accept": "application/json"

            },

            timeout: 30000

        });

        if (!response.data?.result) {

            return reply("❌ Invalid API response.");

        }

        const imageUrl = response.data.result;

        if (typeof imageUrl !== "string") {

            return reply("❌ Invalid image URL received.");

        }

        const imageResponse = await axios.get(imageUrl, {

            responseType: "arraybuffer",

            timeout: 30000

        });

        const imageBuffer = Buffer.from(imageResponse.data);

        if (!imageBuffer || imageBuffer.length === 0) {

            return reply("❌ Empty image response.");

        }

        // WhatsApp image safety limit (5MB)

        if (imageBuffer.length > 5 * 1024 * 1024) {

            return reply("❌ Image too large. Try again.");

        }

        await conn.sendMessage(from, {

            image: imageBuffer

        }, { quoted: mek });

        await conn.sendMessage(from, {

            react: { text: "✅", key: mek.key }

        });

    } catch (error) {

        console.error("Waifu command error:", error);

        if (error.response?.status === 404) {

            reply("❌ Image not found.");

        } else if (error.response?.status === 429) {

            reply("❌ Rate limit exceeded. Try again later.");

        } else if (error.code === "ECONNABORTED") {

            reply("❌ Request timed out.");

        } else {

            reply("❌ Failed to fetch waifu image.");

        }

    }

});

// ── MILF ──────────────────────────────────────────────

const BASE_1 = "https://api.princetechn.com/api/anime/milf";

const API_KEY_1 = "prince";

cast({

    pattern: "milf",

    alias: ["milfnsfw"],

    desc: "Get random milf NSFW anime images",

    category: 'anime',

    filename: __filename

}, async (conn, mek, m, {

    from,

    isGroup,

    reply

}) => {

    try {

        // Optional safety: block in groups

        if (isGroup) {

            return reply("❌ This command can only be used in private chat.");

        }

        await conn.sendMessage(from, {

            react: { text: "🔞", key: mek.key }

        });

        const url = `${BASE}?apikey=${API_KEY}`;

        const response = await axios.get(url, {

            headers: {

                "User-Agent": "Mozilla/5.0",

                "Accept": "application/json"

            },

            timeout: 30000

        });

        if (!response.data?.result) {

            return reply("❌ Invalid API response.");

        }

        const imageUrl = response.data.result;

        if (typeof imageUrl !== "string") {

            return reply("❌ Invalid image URL received.");

        }

        const imageResponse = await axios.get(imageUrl, {

            responseType: "arraybuffer",

            timeout: 30000

        });

        const imageBuffer = Buffer.from(imageResponse.data);

        if (!imageBuffer || imageBuffer.length === 0) {

            return reply("❌ Empty image response.");

        }

        // 5MB protection

        if (imageBuffer.length > 5 * 1024 * 1024) {

            return reply("❌ Image too large. Try again.");

        }

        await conn.sendMessage(from, {

            image: imageBuffer

        }, { quoted: mek });

        await conn.sendMessage(from, {

            react: { text: "✅", key: mek.key }

        });

    } catch (error) {

        console.error("Milf command error:", error);

        if (error.response?.status === 404) {

            reply("❌ Image not found.");

        } else if (error.response?.status === 429) {

            reply("❌ Rate limit exceeded. Try again later.");

        } else if (error.code === "ECONNABORTED") {

            reply("❌ Request timed out.");

        } else {

            reply("❌ Failed to fetch image.");

        }

    }

});

// ── RANDOM ANIME ──────────────────────────────────────

const BASE_2 = "https://api.princetechn.com/api/anime/random";

const API_KEY_2 = "prince";

cast({

    pattern: "random",

    alias: ["animerandom", "randomanime"],

    desc: "Get random anime data",

    category: 'anime',

    filename: __filename

}, async (conn, mek, m, {

    from, reply

}) => {

    try {

        await conn.sendMessage(from, {

            react: { text: "🎲", key: mek.key }

        });

        const url = `${BASE}?apikey=${API_KEY}`;

        const response = await axios.get(url, {

            headers: {

                "User-Agent": "Mozilla/5.0",

                "Accept": "application/json"

            },

            timeout: 30000

        });

        if (!response.data?.result) {

            return reply("❌ Invalid API response.");

        }

        const animeData = response.data.result;

        // Build caption

        let caption = `*${animeData.title || "Unknown"}*\n\n`;

        if (animeData.episodes)

            caption += `📺 Episodes: ${animeData.episodes}\n`;

        if (animeData.status)

            caption += `📊 Status: ${animeData.status}\n`;

        if (animeData.synopsis)

            caption += `\n📝 ${animeData.synopsis}\n`;

        if (animeData.link)

            caption += `\n🔗 ${animeData.link}`;

        // Try downloading image

        let imageBuffer = null;

        if (animeData.thumbnail) {

            try {

                const imageResponse = await axios.get(animeData.thumbnail, {

                    responseType: "arraybuffer",

                    timeout: 30000

                });

                imageBuffer = Buffer.from(imageResponse.data);

                // Skip if too large (5MB limit)

                if (imageBuffer.length > 5 * 1024 * 1024) {

                    imageBuffer = null;

                }

            } catch (err) {

                console.log("Thumbnail download failed.");

                imageBuffer = null;

            }

        }

        if (imageBuffer) {

            await conn.sendMessage(from, {

                image: imageBuffer,

                caption

            }, { quoted: mek });

        } else {

            await conn.sendMessage(from, {

                text: caption

            }, { quoted: mek });

        }

        await conn.sendMessage(from, {

            react: { text: "✅", key: mek.key }

        });

    } catch (error) {

        console.error("Random anime error:", error);

        if (error.response?.status === 404) {

            reply("❌ Anime data not found.");

        } else if (error.response?.status === 429) {

            reply("❌ Rate limit exceeded. Try again later.");

        } else if (error.code === "ECONNABORTED") {

            reply("❌ Request timed out.");

        } else {

            reply("❌ Failed to fetch anime data.");

        }

    }

});

// ── REACTION GIFS — react ─────────────────────────────

const validEndpoints = [
  'poke','hug','hold','hifi','bite','blush','punch','pat',
  'kiss','kill','happy','dance','yeet','wink','slap','bonk',
  'bully','cringe','cuddle'
];

cast({
  pattern: 'react',
  alias: ['reaction'],
  desc: 'Send a reaction GIF. Usage: /react hug',
  category: 'anime',
  filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    const term = (q || '').toLowerCase().trim();
    if (!term || !validEndpoints.includes(term)) {
      return reply(`*Please provide a valid reaction type:*\n\n${validEndpoints.join(', ')}\n\n*Example:* /react hug`);
    }
    const res = await axios.get(`https://api.waifu.pics/sfw/${term}`).catch(() => null);
    if (!res?.data?.url) return reply('*Could not find any gif*');
    await conn.sendMessage(from, {
      video: { url: res.data.url },
      caption: `_${config.BOT_NAME || 'NEXUS-MD'}_`,
      gifPlayback: true
    }, { quoted: mek });
  } catch (e) {
    reply(`❌ Error: ${e.message}`);
  }
});

// ── NSFW ANIME ────────────────────────────────────────

const caption = `_${config.BOT_NAME || 'NEXUS-MD'}_`;

// ── helper ────────────────────────────────────────────────────────────
const nsfwImg = (pattern, endpoint, desc) => {
  cast({ pattern, desc, category: 'anime', filename: __filename },
  async (conn, mek, m, { from, reply }) => {
    try {
      const res  = await fetch(`https://api.maher-zubair.tech/nsfw/${endpoint}`);
      const data = await res.json();
      if (data.status === 200 && data.url) {
        await conn.sendMessage(from, { image: { url: data.url }, caption }, { quoted: mek });
      } else {
        reply('*_Request failed, try again!_*');
      }
    } catch (e) { reply(`❌ Error: ${e.message}`); }
  });
};

// ── commands ──────────────────────────────────────────────────────────
nsfwImg('pussy',      'pussy',     'NSFW image');
nsfwImg('ass',        'ass',       'NSFW image');
nsfwImg('boobs',      'boobs',     'NSFW image');
nsfwImg('yuri',       'yuri',      'NSFW image');
nsfwImg('dick',       'dick',      'NSFW image');
nsfwImg('hentailesb', 'lesbian',   'NSFW image');
nsfwImg('blowjob',    'blowjob',   'NSFW image');
nsfwImg('bdsm',       'bdsm',      'NSFW image');
nsfwImg('fuck',       'fuck',      'NSFW image');
nsfwImg('fingering',  'fingering', 'NSFW image');

// nsfw waifu (waifu.pics)
cast({ pattern: 'nwaifu', desc: 'NSFW waifu image', category: 'anime', filename: __filename },
async (conn, mek, m, { from, reply }) => {
  try {
    const res = await fetch('https://waifu.pics/api/nsfw/waifu');
    const data = await res.json();
    if (data.url) {
      await conn.sendMessage(from, { image: { url: data.url }, caption }, { quoted: mek });
    } else reply('*_Could not fetch waifu image!_*');
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// nai — AI nsfw image generation
cast({ pattern: 'nai', desc: 'Generate AI NSFW image', category: 'anime', filename: __filename },
async (conn, mek, m, { from, q, reply }) => {
  try {
    if (!q) return reply(`*Example:* ${config.PREFIX || '/'}nai anime girl`);
    await conn.sendMessage(from, { text: '⏳ *Generating image...*' }, { quoted: mek });
    const res = await fetch(`https://api.maher-zubair.tech/nsfw/x-gen?q=${encodeURIComponent(q)}`);
    if (!res.ok) return reply(`*Error: ${res.status} ${res.statusText}*`);
    const contentType = res.headers.get('content-type') || '';
    if (contentType.startsWith('image')) {
      await conn.sendMessage(from, { image: { url: res.url }, caption }, { quoted: mek });
    } else {
      const data = await res.json();
      if (data.result) {
        await conn.sendMessage(from, { image: { url: data.result }, caption }, { quoted: mek });
      } else reply('*_Failed to generate image!_*');
    }
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

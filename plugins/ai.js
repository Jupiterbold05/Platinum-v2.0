'use strict';

const { cast, makeSmartQuote, applyFont } = require('../cast');

const config = require('../config');
const axios = require('axios');

const fs = require("fs");

// ── AI CHAT — chat, platinum, eleven ──────────────────

// 1. DavidXTech AI (POST Request)
cast({
    pattern: "chat",
    alias: ["dx", "davidx"],
    desc: "Chat with DavidXTech AI",
    category: 'ai',
    react: "🤖",
    filename: __filename
},
async (conn, mek, m, { from, q, reply, react }) => {
    try {
        if (!q) return reply("Please provide a message.\nExample: `.chat How are you?`");

        const response = await axios.post('https://api.davidxtech.de/ai/ai-chat', 
            { message: q }, 
            {
                headers: {
                    'accept': '*/*',
                    'X-API-Key': 'FREE-TEST-KEY-3000',
                    'Content-Type': 'application/json'
                }
            }
        );

        const data = response.data;
        if (!data || !data.response) {
            await react("❌");
            return reply("DavidXTech AI failed to respond.");
        }

        await reply(`🤖 *DavidXTech AI:*\n\n${data.response}`);
        await react("✅");
    } catch (e) {
        console.error("Error in DavidXTech AI:", e);
        await react("❌");
        reply("An error occurred with the DavidXTech API.");
    }
});

// 2. GiftedTech AI (GET Request)
cast({
    pattern: "platinum",
    alias: ["gt", "giftedai"],
    desc: "Chat with GiftedTech AI",
    category: 'ai',
    react: "🎁",
    filename: __filename
},
async (conn, mek, m, { from, q, reply, react }) => {
    try {
        if (!q) return reply("Please provide a message.\nExample: `.platinum What do you know?`");

        const apiUrl = `https://api.giftedtech.co.ke/api/ai/ai?apikey=gifted&q=${encodeURIComponent(q)}`;
        const { data } = await axios.get(apiUrl);

        if (!data || !data.result) {
            await react("❌");
            return reply("NEXUS-MD AI failed to respond.");
        }

        await reply(`🎁 *GiftedTech AI:*\n\n${data.result}`);
        await react("✅");
    } catch (e) {
        console.error("Error in GiftedTech AI:", e);
        await react("❌");
        reply("An error occurred with the GiftedTech API.");
    }
});

// 3. Arcane GPT (GET Request with Session Memory)
cast({
    pattern: "eleven",
    alias: ["nx", "cipher"],
    desc: "Chat with Arcane GPT",
    category: 'ai',
    react: "🔮",
    filename: __filename
},
// Added 'sender' to the destructured variables below
async (conn, mek, m, { from, q, reply, react, sender }) => {
    try {
        if (!q) return reply("Please provide a message.\nExample: `.eleven Explain quantum physics`");

        // Added session_id parameter and encoded the sender's ID to keep the URL safe
        const apiUrl = `https://arcane-nx-cipher-pol.hf.space/api/ai/gpt?q=${encodeURIComponent(q)}&session_id=${encodeURIComponent(sender)}`;
        const { data } = await axios.get(apiUrl);

        if (!data || !data.result) {
            await react("❌");
            return reply("Eleve's AI failed to respond.");
        }

        await reply(`🔮 *Arcane Response:*\n\n${data.result}`);
        await react("✅");
    } catch (e) {
        console.error("Error in Arcane AI:", e);
        await react("❌");
        reply("An error occurred with the Arcane API.");
    }
});

// ── AI IMAGE — imagine ────────────────────────────────

const BASE = "https://api.siputzx.my.id/api/ai/magicstudio";

cast({

    pattern: "imagine",

    alias: ["magic", "magicai", "aiimage", "generate"],

    desc: "Generate AI art from text prompt",

    category: 'ai',

    filename: __filename

}, async (conn, mek, m, {

    from,

    args,

    reply

}) => {

    try {

        const prompt = args.join(" ").trim();

        if (!prompt) {

            return reply(

                "*Usage:* .imagine <prompt>\n\nExample:\n.imagine a cyberpunk city"

            );

        }

        // React while generating (since AI takes time)

        await conn.sendMessage(from, {

            react: { text: "🎨", key: mek.key }

        });

        const url = `${BASE}?prompt=${encodeURIComponent(prompt)}`;

        const response = await axios.get(url, {

            responseType: "arraybuffer",

            timeout: 120000

        });

        const imageBuffer = Buffer.from(response.data);

        if (!imageBuffer || imageBuffer.length === 0) {

            return reply("❌ Empty response from API.");

        }

        if (imageBuffer.length > 5 * 1024 * 1024) {

            return reply("❌ Generated image is too large. Try a shorter prompt.");

        }

        await conn.sendMessage(from, {

            image: imageBuffer,

            caption: `🎨 *Prompt:* ${prompt}`

        }, { quoted: mek });

        await conn.sendMessage(from, {

            react: { text: "✅", key: mek.key }

        });

    } catch (error) {

        console.error("Imagine command error:", error);

        if (error.response?.status === 429) {

            reply("❌ Rate limit exceeded. Try again later.");

        } else if (error.response?.status === 400) {

            reply("❌ Invalid prompt.");

        } else if (error.response?.status === 500) {

            reply("❌ Server error. Try again later.");

        } else if (error.code === "ECONNABORTED") {

            reply("❌ Generation timed out. Try again.");

        } else {

            reply("❌ Failed to generate image.");

        }

    }

});

// ── AI GENERATORS — fluxai, stablediffusion, stabilityai 

cast({
  pattern: "fluxai",
  alias: ["flux", "fluximage"],
  react: "🚀",
  desc: "Generate an image using AI.",
  category: 'ai',
  filename: __filename
}, async (conn, mek, m, { q, reply }) => {
  try {
    if (!q) return reply("Please provide a prompt for the image.");

    await reply("> *CREATING IMAGINE ...🔥*");

    const apiUrl = `https://api.siputzx.my.id/api/ai/flux?prompt=${encodeURIComponent(q)}`;

    const response = await axios.get(apiUrl, { responseType: "arraybuffer" });

    if (!response || !response.data) {
      return reply("Error: The API did not return a valid image. Try again later.");
    }

    const imageBuffer = Buffer.from(response.data, "binary");

    await conn.sendMessage(m.chat, {
      image: imageBuffer,
      caption: `💸 *Imagine Generated By Pʟᴀᴛɪɴᴜᴍ-V1* 🚀\n✨ Prompt: *${q}*`
    });

  } catch (error) {
    console.error("FluxAI Error:", error);
    reply(`An error occurred: ${error.response?.data?.message || error.message || "Unknown error"}`);
  }
});

cast({
  pattern: "stablediffusion",
  alias: ["sdiffusion", "imagine2"],
  react: "🚀",
  desc: "Generate an image using AI.",
  category: 'ai',
  filename: __filename
}, async (conn, mek, m, { q, reply }) => {
  try {
    if (!q) return reply("Please provide a prompt for the image.");

    await reply("> *CREATING IMAGINE ...🔥*");

    const apiUrl = `https://api.siputzx.my.id/api/ai/stable-diffusion?prompt=${encodeURIComponent(q)}`;

    const response = await axios.get(apiUrl, { responseType: "arraybuffer" });

    if (!response || !response.data) {
      return reply("Error: The API did not return a valid image. Try again later.");
    }

    const imageBuffer = Buffer.from(response.data, "binary");

    await conn.sendMessage(m.chat, {
      image: imageBuffer,
      caption: `💸 *Imagine Generated BY PATRON-MD*🚀\n✨ Prompt: *${q}*`
    });

  } catch (error) {
    console.error("FluxAI Error:", error);
    reply(`An error occurred: ${error.response?.data?.message || error.message || "Unknown error"}`);
  }
});

cast({
  pattern: "stabilityai",
  alias: ["stability", "imagine3"],
  react: "🚀",
  desc: "Generate an image using AI.",
  category: 'ai',
  filename: __filename
}, async (conn, mek, m, { q, reply }) => {
  try {
    if (!q) return reply("Please provide a prompt for the image.");

    await reply("> *CREATING IMAGINE ...🔥*");

    const apiUrl = `https://api.siputzx.my.id/api/ai/stabilityai?prompt=${encodeURIComponent(q)}`;

    const response = await axios.get(apiUrl, { responseType: "arraybuffer" });

    if (!response || !response.data) {
      return reply("Error: The API did not return a valid image. Try again later.");
    }

    const imageBuffer = Buffer.from(response.data, "binary");

    await conn.sendMessage(m.chat, {
      image: imageBuffer,
      caption: `💸 *Imagine Generated BY Pʟᴀᴛɪɴᴜᴍ-V1*🚀\n✨ Prompt: *${q}*`
    });

  } catch (error) {
    console.error("FluxAI Error:", error);
    reply(`An error occurred: ${error.response?.data?.message || error.message || "Unknown error"}`);
  }
});

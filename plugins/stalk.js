// plugins/safe_commands.js
// Commands: gitstalk, ipstalk, tkdl, gitclone, gtts, toksound, bible, aza
'use strict';
const { makeSmartQuote } = require('../cast');

const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const fetch = require('node-fetch');
const { cast }  = require('../cast');
const config    = require('../config');

const TEMP = path.join(__dirname, '../temp');

// ─────────────────────────────────────────────────────────────────────────────
// GITSTALK — Official GitHub API, no key needed
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern:  'gitstalk',
  desc:     'Get information about a GitHub user',
  category: 'stalker',
  use:      '<username>',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    if (!q) return reply('*Provide a GitHub username!*\nExample: :gitstalk torvalds');

    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(q.trim())}`, {
      headers: { 'User-Agent': 'NEXUS-MD-Bot' }
    });
    if (res.status === 404) return reply('*User not found on GitHub.*');
    if (!res.ok) return reply(`*Error ${res.status}*`);
    const u = await res.json();

    const caption =
      `*🐙 GitHub Stalker*\n\n` +
      `*Username:* ${u.login}\n` +
      `*Name:* ${u.name || 'N/A'}\n` +
      `*ID:* ${u.id}\n` +
      `*Bio:* ${u.bio || 'N/A'}\n` +
      `*Company:* ${u.company || 'N/A'}\n` +
      `*Blog:* ${u.blog || 'N/A'}\n` +
      `*Location:* ${u.location || 'N/A'}\n\n` +
      `*Public Repos:* ${u.public_repos}\n` +
      `*Gists:* ${u.public_gists}\n` +
      `*Followers:* ${u.followers}\n` +
      `*Following:* ${u.following}\n\n` +
      `*Created:* ${new Date(u.created_at).toDateString()}\n` +
      `*Updated:* ${new Date(u.updated_at).toDateString()}`;

    await conn.sendMessage(from, { image: { url: u.avatar_url }, caption }, { quoted: mek });
  } catch (e) { reply('Error: ' + e.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// IPSTALK — ip-api.com, free, no key
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern:  'ipstalk',
  desc:     'Get information about an IP address',
  category: 'stalker',
  use:      '<ip address>',
  filename: __filename,
}, async (conn, mek, m, { q, reply }) => {
  try {
    if (!q) return reply('*Provide an IP address!*\nExample: :ipstalk 8.8.8.8');

    const res = await fetch(`https://ip-api.com/json/${encodeURIComponent(q.trim())}?fields=66846719`);
    const d   = await res.json();
    if (d.status === 'fail') return reply(`*Could not fetch IP info: ${d.message}*`);

    reply(
      `*🌐 IP Lookup*\n\n` +
      `*IP:* ${d.query}\n` +
      `*Reverse DNS:* ${d.reverse || 'N/A'}\n` +
      `*Continent:* ${d.continent}\n` +
      `*Country:* ${d.country} (${d.countryCode})\n` +
      `*Region:* ${d.regionName}\n` +
      `*City:* ${d.city}\n` +
      `*ZIP:* ${d.zip || 'N/A'}\n` +
      `*Lat/Lon:* ${d.lat}, ${d.lon}\n` +
      `*Timezone:* ${d.timezone}\n` +
      `*Currency:* ${d.currency}\n` +
      `*ISP:* ${d.isp}\n` +
      `*Org:* ${d.org}\n` +
      `*AS:* ${d.as}\n` +
      `*Mobile:* ${d.mobile ? 'Yes' : 'No'}\n` +
      `*Proxy/VPN:* ${d.proxy ? 'Yes' : 'No'}\n` +
      `*Hosting:* ${d.hosting ? 'Yes' : 'No'}`
    );
  } catch (e) { reply('Error: ' + e.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// TKDL — TikTok downloader via tikwm.com, no key
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern:  'tkdl',
  alias:    ['tiktokdl', 'ttdl', 'tt'],
  desc:     'Download a TikTok video without watermark',
  category: 'downloader',
  use:      '<tiktok url>',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    if (!q) return reply('*Provide a TikTok URL!*');
    if (!q.includes('tiktok') && !q.includes('vm.tiktok')) return reply('*Provide a valid TikTok URL.*');

    await reply('_Fetching TikTok video..._');

    const res  = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(q.trim())}`);
    const data = await res.json();
    if (!data?.data?.play) return reply('*Could not fetch video. Link may be invalid or expired.*');

    const d       = data.data;
    const caption = `*🎵 TikTok Download*\n\n*Title:* ${d.title || 'N/A'}\n*Author:* @${d.author?.unique_id || 'N/A'}`;

    await conn.sendMessage(from, { video: { url: d.play }, caption }, { quoted: mek });
  } catch (e) { reply('Error: ' + e.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GITCLONE — Direct GitHub zip download, no API
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern:  'gitclone',
  alias:    ['gitdl', 'ghclone'],
  desc:     'Download a GitHub repository as a zip file',
  category: 'downloader',
  use:      '<github repo url>',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    const ctx  = mek.message?.extendedTextMessage?.contextInfo;
    const text = q || ctx?.quotedMessage?.conversation || ctx?.quotedMessage?.extendedTextMessage?.text;
    if (!text) return reply('*Provide a GitHub URL!*\nExample: :gitclone https://github.com/Jupiterbold05/Platinum-v2.0');

    const match = text.match(/(?:https?:\/\/|git@)github\.com[/:]([^/:]+)\/(.+)/i);
    if (!match) return reply('*Provide a valid GitHub repository URL.*');

    const [, owner, repoRaw] = match;
    const repo = repoRaw.replace(/\.git$/, '');

    await reply(`_Downloading *${owner}/${repo}*..._`);

    // Try main branch first, fall back to master
    let buf;
    for (const branch of ['main', 'master']) {
      try {
        const res = await axios.get(
          `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`,
          { responseType: 'arraybuffer', timeout: 30000 }
        );
        if (res.data?.byteLength) { buf = Buffer.from(res.data); break; }
      } catch {}
    }

    if (!buf) return reply('*Could not download. Check the URL or repo may be private.*');

    await conn.sendMessage(from, {
      document: buf,
      fileName: `${repo}.zip`,
      mimetype: 'application/zip',
      caption: `📦 *${owner}/${repo}*`
    }, { quoted: mek });
  } catch (e) { reply('Error: ' + e.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GTTS — Google TTS via google-tts-api npm (renamed from tts to avoid conflict)
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern:  'gtts',
  alias:    ['googletts', 'speak2'],
  desc:     'Convert text to speech (Google TTS)',
  category: 'misc',
  use:      '[lang] <text>  — default lang: en',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    const ctx  = mek.message?.extendedTextMessage?.contextInfo;
    const text = q || ctx?.quotedMessage?.conversation || ctx?.quotedMessage?.extendedTextMessage?.text;
    if (!text) return reply('*Provide text!*\nExample: :gtts Hello I am NEXUS-MD\n:gtts es Hola soy Kylie');

    const googleTTS = require('google-tts-api');
    const words = text.trim().split(' ');
    let lang   = 'en';
    let speech = text;
    if (words[0]?.length === 2 && /^[a-z]{2}$/i.test(words[0])) {
      lang   = words[0].toLowerCase();
      speech = words.slice(1).join(' ');
    }
    if (!speech.trim()) return reply('*Provide text after the language code!*');

    const audioUrl = googleTTS.getAudioUrl(speech, {
      lang, slow: false, host: 'https://translate.google.com'
    });

    await conn.sendMessage(from, {
      audio: { url: audioUrl },
      mimetype: 'audio/mpeg',
      ptt: true,
      fileName: 'gtts.mp3'
    }, { quoted: mek });
  } catch (e) { reply('Error: ' + e.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// TOKSOUND — TikTok sounds 1–160 from GitHub raw (renamed from 'sound')
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern:  'toksound',
  alias:    ['tksound', 'tiktoksound'],
  desc:     'Send a TikTok sound by number (1–160)',
  category: 'downloader',
  use:      '<1-160>',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    const n = parseInt(q);
    if (!q || isNaN(n) || n < 1 || n > 160) return reply('*Give a number between 1 and 160*\nExample: :toksound 5');

    const url = `https://github.com/Itxxwasi/Tiktokmusic-API/raw/master/tiktokmusic/sound${n}.mp3`;
    const buf = await (await fetch(url)).buffer();
    if (!buf?.length) return reply('*Sound not found.*');

    await conn.sendMessage(from, {
      audio: buf,
      mimetype: 'audio/mpeg',
      ptt: true,
      fileName: `toksound_${n}.mp3`
    }, { quoted: mek });
  } catch (e) { reply('Error: ' + e.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// BIBLE — bible-api.com, free, no key
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern:  'bible',
  react:    '📖',
  desc:     'Get a Bible verse',
  category: 'fun',
  use:      '<book chapter:verse>  e.g. john 3:16',
  filename: __filename,
}, async (conn, mek, m, { q, reply }) => {
  try {
    if (!q) return reply('*Provide a verse reference!*\nExample: :bible john 3:16');

    const res  = await fetch(`https://bible-api.com/${encodeURIComponent(q.trim())}`);
    if (!res.ok) return reply(`*Error ${res.status}*`);
    const data = await res.json();
    if (data.error) return reply(`*Not found:* ${data.error}`);

    reply(
      `╔════k═y═l═i═e════╗\n` +
      `║ 📖 *${data.reference}*\n║\n` +
      `║ ${data.text.trim()}\n║\n` +
      `║ _Powered by NEXUS-MD_\n` +
      `╚════k═y═l═i═e════╝`
    );
  } catch (e) { reply('Error: ' + e.message); }
});

// ─────────────────────────────────────────────────────────────────────────────
// AZA — Bank account display
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern:  'aza',
  react:    '💳',
  desc:     'Display bank account information',
  category: 'info',
  filename: __filename,
}, async (conn, mek, m, { reply }) => {
  reply(
    `￣￣￣￣￣￣￣￣￣￣￣￣￣|\n` +
    `        *6718656033*\n` +
    `         *MONIEPOINT*\n` +
    `        *EXCEL MAXEELL-UGIAGBE*\n` +
    `|＿＿＿＿＿＿＿＿＿＿＿＿＿|\n` +
    `                     \\•◡•)/\n` +
    `                       \\\\     /\n` +
    `                        ——\n` +
    `                        |     |\n` +
    `                        |_   |_`
  );
});

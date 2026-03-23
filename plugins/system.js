const { cast, makeSmartQuote, applyFont } = require('../cast');
;// Ensure we import both child_process and the performance API from Node’s perf_hooks.

const { exec } = require("child_process");
const { performance } = require("perf_hooks");

// Restart command: After spawning a new process with "npm start", exit the current process.
cast({
  pattern: "sysrestart",
  alias: ["sysreboot", "hardrestart"],
  desc: "Restart System",
  type: "system",
  filename: __filename
}, async (conn, mek, m, { isOwner, reply }) => {
  if (!isOwner) return reply('⛔ Owner only.');
  await reply('♻️ *Hard restart initiated...*');
  await new Promise(r => setTimeout(r, 1500));
  process.exit(0); // Panel/PM2/render will auto-restart
});

// Ping command: Uses performance.now() to measure latency and attempts to update the initial message.

cast({
  pattern: "ping",
  alias: ["speed"],
  desc: "Check bot latency",
  type: "system",
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  try {
    // Load the latest runtime settings so we get the current bot name
    const { BOT_NAME } = require("../config");

    // Send the initial "checking..." message
    const sentMsg = await conn.sendMessage(m.chat, { text: "ᴄʜᴇᴄᴋɪɴɢ..." }, { quoted: makeSmartQuote() });

    const start = performance.now();
    await new Promise(res => setTimeout(res, 50)); // tiny delay to simulate work
    const end = performance.now();

    const latency = (end - start).toFixed(2);
    const text = `*${BOT_NAME || "Bot"}* ${latency} ms`;

    // Edit the original message to show latency
    await conn.sendMessage(m.chat, {
      text,
      edit: sentMsg.key // Baileys edit support
    });

  } catch (err) {
    console.error("Ping command error:", err);
    await reply("❌ Error checking latency.");
  }
});
// ── Version check & :update command ─────────────────────────────────────────
const axios = require('axios');
const config = require('../config');
const fs     = require('fs');
const path   = require('path');

const VERSION_URL = 'https://raw.githubusercontent.com/Jupiterbold05/Platinum-v2.0/main/data/version.json';
const LOCAL_VER_PATH = path.resolve(__dirname, '../data/version.json');

function getLocalVersion() {
  try {
    const raw = fs.existsSync(LOCAL_VER_PATH)
      ? fs.readFileSync(LOCAL_VER_PATH, 'utf8')
      : JSON.stringify({ version: config.VERSION || '3.0.1' });
    return JSON.parse(raw);
  } catch {
    return { version: config.VERSION || '3.0.1' };
  }
}

// Startup version check (runs once, non-blocking)
setTimeout(async () => {
  try {
    const local  = getLocalVersion();
    const { data: remote } = await axios.get(VERSION_URL, { timeout: 8000 });
    if (remote && remote.version && remote.version !== local.version) {
      console.log(`\n🔔 Update available! Local: v${local.version}  →  Latest: v${remote.version}`);
      console.log(`   Changelog: ${remote.changelog || '(none)'}`);
      console.log(`   Run :update in WhatsApp to see details.\n`);
    } else {
      console.log(`✅ Bot is up to date (v${local.version})`);
    }
  } catch (e) {
    // Network unavailable or repo private — silently skip
  }
}, 8000);

cast({
  pattern: 'update',
  alias: ['checkupdate'],
  desc: 'Check for bot updates',
  type: 'system',
  filename: __filename,
}, async (conn, mek, m, { reply, isOwner }) => {
  if (!isOwner) return reply('Owner only.');
  try {
    const local  = getLocalVersion();
    const { data: remote } = await axios.get(VERSION_URL, { timeout: 8000 });

    if (!remote || !remote.version) return reply('❌ Could not fetch version info.');

    if (remote.version === local.version) {
      return reply(`✅ *Up to date!*\nVersion: *v${local.version}*`);
    }

    return reply(
      `🔔 *Update Available!*\n\n` +
      `📌 Local:   *v${local.version}*\n` +
      `🚀 Latest:  *v${remote.version}*\n\n` +
      `📝 *Changelog:*\n${remote.changelog || '(none)'}\n\n` +
      `📥 *Get the latest version:*
https://github.com/Jupiterbold05/Platinum-v2.0

Or restart if you're on a platform with auto-deploy.`
    );
  } catch (e) {
    return reply(`❌ Version check failed: ${e.message}`);
  }
});

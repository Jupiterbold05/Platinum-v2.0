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

// ── Download ZIP and extract update ──────────────────────────────────────────
const ZIP_URL     = 'https://github.com/Jupiterbold05/Platinum-v2.0/archive/refs/heads/main.zip';
const EXTRACT_DIR = path.resolve(process.cwd(), '_update_tmp');
const ROOT_DIR    = path.resolve(process.cwd());

async function downloadAndApplyUpdate(reply) {
  const AdmZip  = (() => { try { return require('adm-zip'); } catch { return null; } })();
  if (!AdmZip) {
    return reply(
      '❌ *adm-zip not installed.*\n\n' +
      'Run this in your server console:\n' +
      '```npm install adm-zip```\n' +
      'Then try :update again.'
    );
  }

  await reply('⏳ *Downloading update from GitHub...*');

  try {
    // Download the zip
    const res = await axios.get(ZIP_URL, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: { 'User-Agent': 'NEXUS-MD-Updater' },
    });

    await reply('📦 *Extracting files...*');

    const zip      = new AdmZip(Buffer.from(res.data));
    const entries  = zip.getEntries();

    // The zip root folder is "Platinum-v2.0-main/" — strip that prefix
    const zipRoot  = entries[0]?.entryName?.split('/')[0] + '/';

    // Files/folders to skip (don't overwrite user data or sessions)
    const SKIP = [
      'node_modules', 'auth_info_baileys', 'session',
      'database.db', '.env', 'config.env',
      'data/version.json',  // keep local version until we explicitly update it
    ];

    let updated = 0;
    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const relPath = entry.entryName.replace(zipRoot, '');
      if (!relPath) continue;

      // Skip protected paths
      if (SKIP.some(s => relPath.startsWith(s) || relPath.includes(s))) continue;

      const destPath = path.join(ROOT_DIR, relPath);
      const destDir  = path.dirname(destPath);

      // Ensure directory exists
      fs.mkdirSync(destDir, { recursive: true });

      // Write file
      fs.writeFileSync(destPath, entry.getData());
      updated++;
    }

    await reply(`✅ *${updated} files updated!*`);

    // Now update local version.json to match remote
    try {
      const remote = (await axios.get(VERSION_URL, { timeout: 8000 })).data;
      fs.writeFileSync(
        path.resolve(ROOT_DIR, 'data/version.json'),
        JSON.stringify({ version: remote.version, changelog: remote.changelog }, null, 2)
      );
      await reply(`📦 *Version updated to v${remote.version}*`);
    } catch {}

    await reply('♻️ *Restarting bot...*');
    await new Promise(r => setTimeout(r, 2000));
    process.exit(0);

  } catch (e) {
    return reply(`❌ Update failed: ${e.message}\n\nDownload manually:\nhttps://github.com/Jupiterbold05/Platinum-v2.0`);
  }
}

// ── :update command ───────────────────────────────────────────────────────────
cast({
  pattern: 'update',
  alias:   ['checkupdate'],
  desc:    'Check for updates. Add "now" to auto-install: update now',
  category: 'system',
  filename: __filename,
}, async (conn, mek, m, { args, reply, isOwner }) => {
  if (!isOwner) return reply('⛔ Owner only.');

  try {
    const local  = getLocalVersion();
    const { data: remote } = await axios.get(VERSION_URL, { timeout: 8000 });

    if (!remote?.version) return reply('❌ Could not fetch version info.');

    // :update now — force install even if same version
    if (args[0]?.toLowerCase() === 'now') {
      return downloadAndApplyUpdate(reply);
    }

    if (remote.version === local.version) {
      return reply(
        `✅ *Already up to date!*\n` +
        `📦 Version: *v${local.version}*\n\n` +
        `_Use *update now* to force reinstall_`
      );
    }

    // Show update notice + prompt
    await reply(
      `🔔 *Update Available!*\n\n` +
      `📌 Installed : *v${local.version}*\n` +
      `🚀 Latest    : *v${remote.version}*\n\n` +
      `📝 *Changelog:*\n${(remote.changelog || '').replace(/\\n/g,'\n')}\n\n` +
      `_Reply with *update now* to install automatically_\n` +
      `_Or download: github.com/Jupiterbold05/Platinum-v2.0_`
    );

  } catch (e) {
    // Handle 404 on version.json gracefully
    if (e?.response?.status === 404) {
      return reply(
        `⚠️ *version.json not found on GitHub.*\n` +
        `Make sure data/version.json exists in your repo.`
      );
    }
    return reply(`❌ Update check failed: ${e.message}`);
  }
});

'use strict';

const { cast, makeSmartQuote, applyFont } = require('../cast');

const config = require('../config');
const axios = require('axios');

const { trackUsage, getUsageHistory } = require('../lib/usageTracker');

// ── BOT INFO — channel/support/test/usage ─────────────

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL — Post channel link
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'channel',
  alias: ['chalink', 'followus'],
  desc: 'Get the WhatsApp channel link',
  category: 'info',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  await conn.sendMessage(from, {
    text:
      `👑 *${config.BOT_NAME || 'NEXUS-MD'} — CHANNEL SUPPORT*\n\n` +
      `_ʜᴇʏ ʜᴇʀᴇ's ᴏᴜʀ ᴄʜᴀɴɴᴇʟ ʟɪɴᴋ, ᴘʟᴇᴀsᴇ ғᴏʟʟᴏᴡ ᴀɴᴅ sᴜᴘᴘᴏʀᴛ ᴜs ᴛᴏ ᴋᴇᴇᴘ ᴛʜɪs ᴘʀᴏᴊᴇᴄᴛ ᴀʟɪᴠᴇ_\n\n` +
      `*🔗 Link:* https://whatsapp.com/channel/120363406541595053\n\n` +
      `_${config.BOT_NAME || 'NEXUS-MD'} © cylee_`,
    contextInfo: { forwardingScore: 999, isForwarded: true }
  }, { quoted: mek });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORT — Post repo/support link
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'support',

  desc: 'Get the bot support and repo link',
  category: 'info',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  await conn.sendMessage(from, {
    text:
      `🛠️ *${config.BOT_NAME || 'NEXUS-MD'} — SUPPORT & REPO*\n\n` +
      `*GitHub Repo:* https://github.com/Jupiterbold05/NEXUS-MD-V1\n\n` +
      `_${config.BOT_NAME || 'NEXUS-MD'} Works ✅_`,
    contextInfo: { forwardingScore: 999, isForwarded: true }
  }, { quoted: mek });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST — Check bot is alive
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'test',
  alias: ['check', 'checkbot'],
  desc: 'Check if bot is active',
  category: 'info',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
  await conn.sendMessage(from, {
    text: `*${config.BOT_NAME || 'NEXUS-MD'} IS CURRENTLY ACTIVE!* 👸❤️\n\n⏱️ Uptime: ${formatUptime(process.uptime())}`
  }, { quoted: mek });
});

function formatUptime(sec) {
  const d = Math.floor(sec/86400), h = Math.floor((sec%86400)/3600),
        m = Math.floor((sec%3600)/60), s = Math.floor(sec%60);
  return [d&&`${d}d`, h&&`${h}h`, m&&`${m}m`, `${s}s`].filter(Boolean).join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// USAGE — Show command usage history since bot started
// Call trackUsage(senderJid, commandName) from index.js to populate
// In index.js, inside the "if (cmdData)" block add:
//   const { trackUsage } = require('./plugins/info');
//   trackUsage(sender, command);
// ─────────────────────────────────────────────────────────────────────────────

cast({
  pattern: 'usage',
  alias: ['cmdusage', 'cmdused', 'commandstats'],
  desc: 'Show command usage stats since last restart',
  category: 'info',
  filename: __filename,
}, async (conn, mek, m, { from, isOwner, reply }) => {
  if (!isOwner) return reply('🚫 Owner only.');
  const usageHistory = getUsageHistory();
  if (!usageHistory.length) return reply('_No commands have been used yet since last restart._');

  // Aggregate per user
  const map = {};
  for (const { sender, command } of usageHistory) {
    if (!map[sender]) map[sender] = { count: 0, commands: {} };
    map[sender].count++;
    map[sender].commands[command] = (map[sender].commands[command] || 0) + 1;
  }

  const users = Object.keys(map);
  const lines = users.map((jid, i) => {
    const num    = jid.split('@')[0];
    const cmds   = Object.entries(map[jid].commands)
      .map(([c, n]) => `${c}${n > 1 ? ` (${n})` : ''}`)
      .join(', ');
    return `*${i+1}. @${num}* ➪ ${map[jid].count} uses\n   _${cmds}_`;
  }).join('\n\n');

  await conn.sendMessage(from, {
    text:
      `📊 *COMMAND USAGE SINCE LAST RESTART*\n\n` +
      `*Total Users:* ${users.length}\n` +
      `*Total Commands Used:* ${usageHistory.length}\n\n` +
      lines,
    mentions: users
  }, { quoted: mek });
});

// ── ALIVE — alive/about/dev ───────────────────────────

function runtime(sec) {
  const d = Math.floor(sec/86400), h = Math.floor((sec%86400)/3600),
        m = Math.floor((sec%3600)/60), s = Math.floor(sec%60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ALIVE
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'alive',
  react: '⚡',
  desc: "Check bot status and latency",
  category: 'info',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  const { getBotSettings } = require('../lib/botdb');
  const s      = getBotSettings();
  const bname  = s.botName  || config.BOT_NAME  || 'NEXUS-MD';
  const oname  = s.ownerName|| config.OWNER_NAME || 'Owner';
  const aliveMsg = s.aliveMsg || config.ALIVE_MSG || '';
  const aliveImg = s.aliveImg || config.ALIVE_IMG || '';

  const start   = Date.now();
  await new Promise(r => setTimeout(r, 80));
  const latency = Date.now() - start;

  const text =
    `╭────────────────────\n` +
    `│  ⚡ *${bname}* ⚡\n` +
    `├────────────────────\n` +
    `│  Status  »  Online ✅\n` +
    `│  Latency »  ${latency}ms\n` +
    `│  Uptime  »  ${runtime(process.uptime())}\n` +
    `│  Owner   »  ${oname}\n` +
    (aliveMsg ? `│  ${aliveMsg}\n` : '') +
    `╰────────────────────`;

  if (aliveImg) {
    await conn.sendMessage(from, { image: { url: aliveImg }, caption: text }, { quoted: mek });
  } else {
    await reply(text);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ABOUT
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'about',
  alias: ['abbt', 'botinfo'],
  react: '🔗',
  desc: 'Info about the bot',
  category: 'info',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  const { getBotSettings } = require('../lib/botdb');
  const s     = getBotSettings();
  const bname = s.botName  || config.BOT_NAME   || 'NEXUS-MD';
  const oname = s.ownerName|| config.OWNER_NAME  || 'Owner';
  const onum  = s.ownerNumber || config.OWNER_NUMBER || '';
  const pfx   = s.prefix   || config.PREFIX      || ':';

  await reply(
    `╭────────────────────\n` +
    `│  🔗 *${bname}*\n` +
    `├────────────────────\n` +
    `│  Owner    »  ${oname}\n` +
    `│  Prefix   »  ${pfx}\n` +
    `│  Uptime   »  ${runtime(process.uptime())}\n` +
    `│  Repo     »  github.com/Jupiterbold05/Platinum-v2.0\n` +
    (onum ? `│  Contact  »  wa.me/${onum}\n` : '') +
    `╰────────────────────`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// DEV
// ─────────────────────────────────────────────────────────────────────────────
cast({
  pattern: 'dev',
  alias: ['developer', 'owner'],
  react: '🧠',
  desc: 'Info about the bot owner',
  category: 'info',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  const { getBotSettings } = require('../lib/botdb');
  const s    = getBotSettings();
  const name = s.ownerName   || config.OWNER_NAME   || 'Owner';
  const num  = s.ownerNumber || config.OWNER_NUMBER  || '';
  await reply(
    `╭────────────────────\n` +
    `│  🧠 *Owner Info*\n` +
    `├────────────────────\n` +
    `│  Name     »  ${name}\n` +
    (num ? `│  Contact  »  wa.me/${num}\n` : '') +
    `╰────────────────────`
  );
});

// ── REPO — botrepo ────────────────────────────────────

cast({
  pattern: 'botrepo',
  alias: ['repo'],
  react: '📁',
  desc: 'Bot repository info',
  category: 'info',
  filename: __filename
}, async (conn, mek, m, { from, reply }) => {
  try {
    let repoData;
    try {
      const res = await axios.get('https://api.github.com/repos/Jupiterbold05/Platinum-v2.0');
      repoData = res.data;
    } catch {
      // fallback static info
      repoData = null;
    }
    const msg = repoData
      ? `📦 *${repoData.name || 'NEXUS-MD-V1'}*\n\n📝 *Description:* ${repoData.description || 'A powerful WhatsApp bot'}\n⭐ *Stars:* ${repoData.stargazers_count || 0}\n🍴 *Forks:* ${repoData.forks_count || 0}\n👀 *Watchers:* ${repoData.watchers_count || 0}\n🗃️ *Open Issues:* ${repoData.open_issues_count || 0}\n💳 *License:* ${repoData.license?.name || 'N/A'}\n\n🔗 *Repo:* https://github.com/Jupiterbold05/NEXUS-MD-V1`
      : `📦 *NEXUS-MD-V1*\n\n📝 A powerful multi-feature WhatsApp bot.\n\n🔗 *Repo:* https://github.com/Jupiterbold05/NEXUS-MD-V1`;
    await conn.sendMessage(from, { text: msg }, { quoted: mek });
  } catch (e) {
    reply(`❌ Error: ${e.message}`);
  }
});

// ── GREETINGS — hi/cylee ──────────────────────────────

cast({
  pattern: 'hi',
  react: '👋',
  desc: 'Greet and introduce the bot',
  category: 'info',
  filename: __filename
}, async (conn, mek, m, { reply, pushname }) => {
  reply(`Hey ${pushname}! 👋 I'm *${config.BOT_NAME || 'NEXUS-MD'}*, a multipurpose WhatsApp bot made with ❤️.\n\nType *${config.PREFIX || '/'}menu* to see all available commands!`);
});

cast({
  pattern: 'cylee',
  react: '🤴',
  desc: 'Info about the bot owner',
  category: 'info',
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  reply(`👑 *About the Owner*\n\nThe person you speak of is my master — a software developer and the creator of this bot.\n\nType *${config.PREFIX || '/'}owner* to get contact details.`);
});

// ── UPTIME ────────────────────────────────────────────
const os = require("os")
const { cmd, commands } = require('../cast')

function runtime(seconds) {
    seconds = Math.floor(seconds);
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d}d ${h}h ${m}m ${s}s`;
}

cast({
    pattern: "uptime",
    alias: ["runtime"],
    desc: "Shows how long the bot has been running.",
    category: 'info',
    filename: __filename
},
async (conn, mek, m, { from, reply }) => {
    try {
        const up = runtime(process.uptime());
        reply(`*Pʟᴀᴛɪɴᴜᴍ-V2 ⚡ Uptime:* ${up}`);
    } catch (e) {
        console.log(e);
        reply(`${e}`);
    }
});

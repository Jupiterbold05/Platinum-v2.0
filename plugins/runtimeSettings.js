// plugins/runtimeSettings.js — NEXUS-MD runtime settings (all via botdb)
'use strict';

const { cast }                             = require('../cast');
const { getBotSettings, saveBotSettings, getFont, setFont } = require('../lib/botdb');
const config                          = require('../config');

// Apply saved settings to config on load
function applyToConfig(s) {
  if (!s || typeof s !== 'object') return;
  if (s.botName)      config.BOT_NAME      = s.botName;
  if (s.ownerName)    config.OWNER_NAME    = s.ownerName;
  if (s.ownerNumber)  config.OWNER_NUMBER  = s.ownerNumber;
  if (s.prefix)       config.PREFIX        = s.prefix;
  if (s.mode)         config.MODE          = s.mode;
  if (s.aliveImg)     config.ALIVE_IMG     = s.aliveImg;
  if (s.aliveMsg)     config.ALIVE_MSG     = s.aliveMsg;
  if (s.stickerPack)  config.STICKER_PACK  = s.stickerPack;
  if (s.stickerAuthor)config.STICKER_AUTHOR= s.stickerAuthor;
  if (s.timezone)     config.TIMEZONE      = s.timezone;
}
applyToConfig(getBotSettings());

function ownerOnly(reply, isOwner) {
  if (!isOwner) { reply('⛔ Owner only.'); return false; }
  return true;
}
function isValidTimezone(tz) {
  try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; }
}

// ── setbotname ────────────────────────────────────────────────────────────────
cast({ pattern:'setbotname', desc:'Set bot name', category:'settings', filename:__filename },
async (conn,mek,m,{args,isOwner,reply}) => {
  if (!ownerOnly(reply,isOwner)) return;
  const name = args.join(' ').trim();
  if (!name) return reply('Usage: setbotname MyBot');
  const s = getBotSettings(); s.botName = name; saveBotSettings(s); applyToConfig(s);
  return reply(`✅ *Bot name set to:* ${name}`);
});

// ── setownername ──────────────────────────────────────────────────────────────
cast({ pattern:'setownername', desc:'Set owner name', category:'settings', filename:__filename },
async (conn,mek,m,{args,isOwner,reply}) => {
  if (!ownerOnly(reply,isOwner)) return;
  const name = args.join(' ').trim();
  if (!name) return reply('Usage: setownername MyName');
  const s = getBotSettings(); s.ownerName = name; saveBotSettings(s); applyToConfig(s);
  return reply(`✅ *Owner name set to:* ${name}`);
});

// ── setownernumber ────────────────────────────────────────────────────────────
cast({ pattern:'setownernumber', desc:'Set owner number', category:'settings', filename:__filename },
async (conn,mek,m,{args,isOwner,reply}) => {
  if (!ownerOnly(reply,isOwner)) return;
  const num = (args[0]||'').replace(/\D/g,'');
  if (!num) return reply('Usage: setownernumber 2348012345678');
  const s = getBotSettings(); s.ownerNumber = num; saveBotSettings(s); applyToConfig(s);
  return reply(`✅ *Owner number set to:* ${num}`);
});

// ── setprefix ─────────────────────────────────────────────────────────────────
cast({ pattern:'setprefix', desc:'Set command prefix', category:'settings', filename:__filename },
async (conn,mek,m,{args,isOwner,reply}) => {
  if (!ownerOnly(reply,isOwner)) return;
  const p = args[0];
  if (!p) return reply('Usage: setprefix :');
  const s = getBotSettings(); s.prefix = p; saveBotSettings(s); applyToConfig(s);
  return reply(`✅ *Prefix set to:* ${p}`);
});

// ── setalivemsg ───────────────────────────────────────────────────────────────
cast({ pattern:'setalivemsg', desc:'Set alive message', category:'settings', filename:__filename },
async (conn,mek,m,{args,isOwner,reply}) => {
  if (!ownerOnly(reply,isOwner)) return;
  const txt = args.join(' ').trim();
  if (!txt) return reply('Usage: setalivemsg Your message...');
  const s = getBotSettings(); s.aliveMsg = txt; saveBotSettings(s); applyToConfig(s);
  return reply('✅ *Alive message saved.*');
});

// ── setaliveimg ───────────────────────────────────────────────────────────────
cast({ pattern:'setaliveimg', desc:'Set alive image URL', category:'settings', filename:__filename },
async (conn,mek,m,{args,isOwner,reply}) => {
  if (!ownerOnly(reply,isOwner)) return;
  const url = args[0];
  if (!url || !url.startsWith('http')) return reply('Usage: setaliveimg https://...');
  const s = getBotSettings(); s.aliveImg = url; saveBotSettings(s); applyToConfig(s);
  return reply('✅ *Alive image saved.*');
});

// ── setstickerpack ────────────────────────────────────────────────────────────
cast({ pattern:'setstickerpack', desc:'Set sticker pack name', category:'settings', filename:__filename },
async (conn,mek,m,{args,isOwner,reply}) => {
  if (!ownerOnly(reply,isOwner)) return;
  const name = args.join(' ').trim();
  if (!name) return reply('Usage: setstickerpack NEXUS-MD');
  const s = getBotSettings(); s.stickerPack = name; saveBotSettings(s); applyToConfig(s);
  return reply(`✅ *Sticker pack set to:* ${name}`);
});

// ── setstickerauthor ──────────────────────────────────────────────────────────
cast({ pattern:'setstickerauthor', desc:'Set sticker author name', category:'settings', filename:__filename },
async (conn,mek,m,{args,isOwner,reply}) => {
  if (!ownerOnly(reply,isOwner)) return;
  const name = args.join(' ').trim();
  if (!name) return reply('Usage: setstickerauthor nexus');
  const s = getBotSettings(); s.stickerAuthor = name; saveBotSettings(s); applyToConfig(s);
  return reply(`✅ *Sticker author set to:* ${name}`);
});

// ── settimezone ───────────────────────────────────────────────────────────────
cast({ pattern:'settimezone', desc:'Set timezone (e.g. Africa/Lagos)', category:'settings', filename:__filename },
async (conn,mek,m,{args,isOwner,reply}) => {
  if (!ownerOnly(reply,isOwner)) return;
  const tz = args.join(' ').trim();
  if (!tz) return reply('Usage: settimezone Africa/Lagos');
  if (!isValidTimezone(tz)) return reply(`❌ Invalid timezone.\nExample: settimezone Africa/Johannesburg`);
  const s = getBotSettings(); s.timezone = tz; saveBotSettings(s); applyToConfig(s);
  return reply(`✅ *Timezone set to:* ${tz}`);
});


// ── setmode ───────────────────────────────────────────────────────────────────
cast({ pattern:'setmode', desc:'Set bot mode: public or private', category:'settings', filename:__filename },
async (conn,mek,m,{args,isOwner,reply}) => {
  if (!ownerOnly(reply,isOwner)) return;
  const opt = (args[0]||'').toLowerCase();
  if (!['public','private'].includes(opt)) return reply('Usage: setmode public\nUsage: setmode private');
  const s = getBotSettings(); s.mode = opt; saveBotSettings(s); applyToConfig(s);
  return reply(`✅ *Mode set to:* ${opt}`);
});

// ── getsettings ───────────────────────────────────────────────────────────────
cast({ pattern:'getsettings', desc:'Show all runtime settings', category:'settings', filename:__filename },
async (conn,mek,m,{isOwner,reply}) => {
  if (!isOwner) return reply('⛔ Owner only.');
  const s = getBotSettings();
  const lines = [
    `╭──『 ⚙️ *NEXUS-MD Settings* 』`,
    `│ 🤖 *Bot Name:*     ${s.botName     || config.BOT_NAME}`,
    `│ 👤 *Owner Name:*   ${s.ownerName   || config.OWNER_NAME}`,
    `│ 📞 *Owner Number:* ${s.ownerNumber || config.OWNER_NUMBER || 'not set'}`,
    `│ 🔑 *Prefix:*       ${s.prefix      || config.PREFIX}`,
    `│ 🌐 *Mode:*         ${s.mode        || config.MODE}`,
    `│ 🎨 *Sticker Pack:* ${s.stickerPack || config.STICKER_PACK}`,
    `│ ✍️ *Sticker Auth:* ${s.stickerAuthor||config.STICKER_AUTHOR}`,
    `│ 🕐 *Timezone:*     ${s.timezone    || config.TIMEZONE}`,
    `╰──────────────────────`,
  ].join('\n');
  return reply(lines);
});

// ── resetsettings ─────────────────────────────────────────────────────────────
cast({ pattern:'resetsettings', desc:'Reset all runtime settings', category:'settings', filename:__filename },
async (conn,mek,m,{isOwner,reply}) => {
  if (!isOwner) return reply('⛔ Owner only.');
  saveBotSettings({});
  return reply('✅ *Runtime settings reset to defaults.*');
});


// ── setfont ───────────────────────────────────────────────────────────────────
cast({ pattern:'setfont', desc:'Set reply font style (1-5)', category:'settings', filename:__filename },
async (conn,mek,m,{args,isOwner,reply}) => {
  if (!isOwner) return reply('⛔ Owner only.');
  const n = parseInt(args[0]);
  if (!n || n < 1 || n > 5) return reply(
    `❗ Usage: setfont <1-5>\n\n` +
    `1 — Default (normal)\n` +
    `2 — 𝐁𝐨𝐥𝐝\n` +
    `3 — 𝐼𝑡𝑎𝑙𝑖𝑐\n` +
    `4 — 𝑩𝒐𝒍𝒅 𝑰𝒕𝒂𝒍𝒊𝒄\n` +
    `5 — 𝙼𝚘𝚗𝚘𝚜𝚙𝚊𝚌𝚎`
  );
  setFont(n);
  const names = {1:'Default',2:'Bold',3:'Italic',4:'Bold Italic',5:'Monospace'};
  return reply(`✅ Font set to: ${names[n]}`);
});

// ── getfont ───────────────────────────────────────────────────────────────────
cast({ pattern:'getfont', desc:'Show current font style', category:'settings', filename:__filename },
async (conn,mek,m,{isOwner,reply}) => {
  if (!isOwner) return reply('⛔ Owner only.');
  const n = getFont();
  const names = {1:'Default',2:'Bold',3:'Italic',4:'Bold Italic',5:'Monospace'};
  return reply(`Current font: *${names[n] || 'Default'}* (${n})`);
});

module.exports = { getBotSettings, saveBotSettings, applyToConfig };

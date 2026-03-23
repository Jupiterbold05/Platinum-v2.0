// plugins/remind.js — NEXUS-MD
// Persistent reminders that survive restarts
'use strict';

const { cast, makeSmartQuote, applyFont } = require('../cast');
const fs   = require('fs');
const path = require('path');

const REMIND_FILE = path.join(__dirname, '../lib/reminders.json');
function readR()  { try { return JSON.parse(fs.readFileSync(REMIND_FILE, 'utf8')); } catch { return []; } }
function saveR(d) { fs.writeFileSync(REMIND_FILE, JSON.stringify(d, null, 2)); }
if (!fs.existsSync(REMIND_FILE)) saveR([]);

const activeTimers = new Map();

function parseTime(str) {
  const map = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const match = str.trim().match(/^(\d+(?:\.\d+)?)(s|m|h|d)$/i);
  if (!match) return null;
  return parseFloat(match[1]) * map[match[2].toLowerCase()];
}

function humanTime(ms) {
  if (ms < 60000)   return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h`;
  return `${Math.round(ms / 86400000)}d`;
}

// ── remind ────────────────────────────────────────────────────────────
cast({
  pattern:  'remind',
  alias:    ['remindme', 'reminder'],
  desc:     'Set a reminder: remind <time> <message> (e.g. 5m, 2h, 1d)',
  category: 'misc',
  react:    '⏰',
  filename: __filename
}, async (conn, mek, m, { from, sender, args, q, reply }) => {
  if (!args[0]) return reply(
    `❗ *Usage:* remind <time> <message>\n\n📌 *Examples:*\n• remind 5m Check the oven\n• remind 2h Team meeting\n• remind 1d Mom's birthday\n\n⏱️ Units: s=sec, m=min, h=hr, d=day`
  );
  const delay = parseTime(args[0]);
  if (!delay) return reply('❗ Invalid time. Use: 30s, 5m, 2h, 1d');
  if (delay < 5000)         return reply('❗ Minimum is 5 seconds.');
  if (delay > 7 * 86400000) return reply('❗ Maximum is 7 days.');

  const message = args.slice(1).join(' ');
  if (!message) return reply('❗ Include a message after the time.');
  const fireAt = Date.now() + delay;
  const id     = `${sender}_${fireAt}`;

  const reminders = readR();
  reminders.push({ id, sender, from, message, fireAt });
  saveR(reminders);

  const timer = setTimeout(async () => {
    try {
      await conn.sendMessage(from, {
        text: `⏰ *REMINDER* @${sender.split('@')[0]}\n\n📌 ${message}`,
        mentions: [sender]
      }, { quoted: mek });
    } catch {}
    activeTimers.delete(id);
    saveR(readR().filter(r => r.id !== id));
  }, delay);
  activeTimers.set(id, timer);

  reply(`✅ *Reminder set!*\n⏱️ In *${humanTime(delay)}*\n📌 "${message}"`);
});

// ── myreminders ───────────────────────────────────────────────────────
cast({
  pattern:  'myreminders',
  alias:    ['reminders', 'listremind'],
  desc:     'List your active reminders',
  category: 'misc',
  react:    '📋',
  filename: __filename
}, async (conn, mek, m, { from, sender, reply }) => {
  const reminders = readR().filter(r => r.sender === sender);
  if (!reminders.length) return reply('📭 No active reminders.\nSet one: *remind <time> <message>*');
  const lines = reminders.map((r, i) => {
    const left = Math.max(0, r.fireAt - Date.now());
    return `${i + 1}. ⏱️ *${humanTime(left)}* left\n   📌 ${r.message}`;
  });
  await conn.sendMessage(from, {
    text: `⏰ *Your Reminders (${reminders.length})*\n\n${lines.join('\n\n')}`
  }, { quoted: mek });
});

// ── cancelremind ──────────────────────────────────────────────────────
cast({
  pattern:  'cancelremind',
  alias:    ['delremind'],
  desc:     'Cancel a reminder: cancelremind <number>',
  category: 'misc',
  react:    '❌',
  filename: __filename
}, async (conn, mek, m, { sender, args, reply }) => {
  const myRems = readR().filter(r => r.sender === sender);
  if (!myRems.length) return reply('📭 No active reminders.');
  const num = parseInt(args[0]) - 1;
  if (isNaN(num) || num < 0 || num >= myRems.length)
    return reply('❗ Use *myreminders* to see your list, then *cancelremind <number>*.');
  const target = myRems[num];
  const timer  = activeTimers.get(target.id);
  if (timer) { clearTimeout(timer); activeTimers.delete(target.id); }
  saveR(readR().filter(r => r.id !== target.id));
  reply(`✅ Cancelled:\n📌 "${target.message}"`);
});

// ── restoreReminders — call from index.js on connection open ──────────
function restoreReminders(conn) {
  const now = Date.now();
  const reminders = readR();
  const keep = [];
  for (const r of reminders) {
    const left = r.fireAt - now;
    if (left <= 0) {
      // Overdue — fire after 2s
      setTimeout(async () => {
        try {
          await conn.sendMessage(r.from, {
            text: `⏰ *REMINDER (overdue)* @${r.sender.split('@')[0]}\n\n📌 ${r.message}`,
            mentions: [r.sender]
          }, { quoted: mek });
        } catch {}
      }, 2000);
    } else {
      keep.push(r);
      const timer = setTimeout(async () => {
        try {
          await conn.sendMessage(r.from, {
            text: `⏰ *REMINDER* @${r.sender.split('@')[0]}\n\n📌 ${r.message}`,
            mentions: [r.sender]
          }, { quoted: mek });
        } catch {}
        activeTimers.delete(r.id);
        saveR(readR().filter(x => x.id !== r.id));
      }, left);
      activeTimers.set(r.id, timer);
    }
  }
  saveR(keep);
  if (keep.length) console.log(`✅ Restored ${keep.length} reminder(s).`);
}

module.exports = { restoreReminders };

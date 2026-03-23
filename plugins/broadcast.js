// plugins/broadcast.js — NEXUS-MD
'use strict';

const { cast, makeSmartQuote } = require('../cast');
const config = require('../config');

function isOwner(sender, conn) {
  const ownerNum = (config.OWNER_NUMBER || '2348084644182').replace(/\D/g,'');
  const botNum   = conn.user.id.split(':')[0];
  const senderNum = sender.split('@')[0].split(':')[0];
  return senderNum === ownerNum || senderNum === botNum;
}

// ── broadcastgroup ────────────────────────────────────────────────────────────
cast({
  pattern:  'brdcastgroup',
  alias:    ['bcgroup', 'bgcast'],
  desc:     'Broadcast a message to all group chats',
  category: 'owner',
  filename: __filename,
}, async (conn, mek, m, { sender, q, reply }) => {
  if (!isOwner(sender, conn)) return reply('❌ Owner only.');
  if (!q) return reply('Usage: broadcastgroup <message>');

  const chats      = Array.from(conn.chats?.keys?.() || []);
  const groups     = chats.filter(c => c.endsWith('@g.us'));
  if (!groups.length) return reply('❌ No group chats found.');

  await reply(`⏳ Broadcasting to *${groups.length}* groups...`);
  let sent = 0, failed = 0;

  for (const chat of groups) {
    try {
      // Header removed here
      await conn.sendMessage(chat, { text: q });
      sent++;
      await new Promise(r => setTimeout(r, 500)); // avoid spam ban
    } catch { failed++; }
  }

  reply(`✅ Broadcast complete!\nSent: *${sent}* | Failed: *${failed}*`);
});

// ── broadcastprivate ──────────────────────────────────────────────────────────
cast({
  pattern:  'brdcastprivate',
  alias:    ['bcprivate', 'bpdm'],
  desc:     'Broadcast a message to all private chats',
  category: 'owner',
  filename: __filename,
}, async (conn, mek, m, { sender, q, reply }) => {
  if (!isOwner(sender, conn)) return reply('❌ Owner only.');
  if (!q) return reply('Usage: broadcastprivate <message>');

  const chats   = Array.from(conn.chats?.keys?.() || []);
  const private_ = chats.filter(c => !c.endsWith('@g.us') && !c.endsWith('@broadcast') && c.endsWith('@s.whatsapp.net'));
  if (!private_.length) return reply('❌ No private chats found.');

  await reply(`⏳ Broadcasting to *${private_.length}* private chats...`);
  let sent = 0, failed = 0;

  for (const chat of private_) {
    try {
      // Header removed here
      await conn.sendMessage(chat, { text: q });
      sent++;
      await new Promise(r => setTimeout(r, 500));
    } catch { failed++; }
  }

  reply(`✅ Broadcast complete!\nSent: *${sent}* | Failed: *${failed}*`);
});

// ── broadcastall ──────────────────────────────────────────────────────────────
cast({
  pattern:  'brdcastall',
  alias:    ['bcall', 'bcast'],
  desc:     'Broadcast a message to ALL chats (groups + private)',
  category: 'owner',
  filename: __filename,
}, async (conn, mek, m, { sender, q, reply }) => {
  if (!isOwner(sender, conn)) return reply('❌ Owner only.');
  if (!q) return reply('Usage: broadcastall <message>');

  const chats = Array.from(conn.chats?.keys?.() || [])
    .filter(c => c.endsWith('@g.us') || c.endsWith('@s.whatsapp.net'));
  if (!chats.length) return reply('❌ No chats found.');

  await reply(`⏳ Broadcasting to *${chats.length}* chats...`);
  let sent = 0, failed = 0;

  for (const chat of chats) {
    try {
      // Header removed here
      await conn.sendMessage(chat, { text: q });
      sent++;
      await new Promise(r => setTimeout(r, 500));
    } catch { failed++; }
  }

  reply(`✅ Broadcast complete!\nSent: *${sent}* | Failed: *${failed}*`);
});
  

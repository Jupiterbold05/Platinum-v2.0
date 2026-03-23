// plugins/tag.js — NEXUS-MD
// tag     — resend message with silent @all notifications, quoted reply style
// hidetag — same but sent standalone (not as reply to command)
'use strict';

const { cast, makeSmartQuote }  = require('../cast');
const { downloadMediaMessage }  = require('@whiskeysockets/baileys');
const axios                     = require('axios');

// ── helper: build the vcard quote ────────────────────────────────────────────
function sq() { return makeSmartQuote(); }

// ── helper: download quoted media safely ─────────────────────────────────────
async function dlMedia(conn, mek, quoted, qMsg) {
  try {
    return await downloadMediaMessage(
      { key: quoted.key || mek.key, message: qMsg },
      'buffer', {},
      { logger: { info(){}, warn(){}, error(){} }, reuploadRequest: conn.updateMediaMessage }
    );
  } catch { return null; }
}

// ── shared tag handler ────────────────────────────────────────────────────────
async function doTag(conn, mek, m, ctx, standalone) {
  const { from, q, isGroup, isAdmins, isOwner, participants, reply } = ctx;
  if (!isGroup)              return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('⚠️ Admins only.');

  const mentions = (participants || []).map(p => p.id);
  // ── No reply — plain text message ─────────────────────────────────────────
  if (!m.quoted) {
    if (!q) return reply('❗ Reply to a message or type text after the command.\n*Example:* tag Good morning!');
    // Send with mentions array — WhatsApp pings everyone silently, no @names visible
    await conn.sendMessage(from,
      { text: q, mentions },
      { quoted: standalone ? undefined : sq() }
    );
    return;
  }

  // ── Replied message ───────────────────────────────────────────────────────
  const quoted = m.quoted;
  // Baileys 7.x sometimes nests message differently
  const qMsg = quoted.message || quoted.msg || 
    (quoted.key ? {} : {}) || {};
  // Also check for viewOnceMessage wrapper
  const actualMsg = qMsg.viewOnceMessage?.message || 
                    qMsg.viewOnceMessageV2?.message?.viewOnceMessage?.message || 
                    qMsg.ephemeralMessage?.message || 
                    qMsg;
  const type   = Object.keys(actualMsg).find(k =>
    ['conversation','extendedTextMessage','imageMessage','videoMessage',
     'audioMessage','stickerMessage','documentMessage'].includes(k)
  );

  if (!type) {
    // If no quoted message type found, try to use text from q as fallback
    if (q) {
      await conn.sendMessage(from, { text: q, mentions }, { quoted: standalone ? undefined : sq() });
      return;
    }
    return reply('❌ Could not read that message type. Try with text instead.\n*Example:* tag Good morning!');
  }

  // Text message
  if (type === 'conversation' || type === 'extendedTextMessage') {
    const text = actualMsg.conversation || actualMsg.extendedTextMessage?.text || '';

    // Group invite link — attach group thumbnail
    const inviteMatch = text.match(/chat\.whatsapp\.com\/([A-Za-z0-9]{20,24})/);
    if (inviteMatch) {
      try {
        const info = await conn.groupGetInviteInfo(inviteMatch[1]).catch(() => null);
        if (info) {
          const caption = `🔗 *${info.subject}*\n👥 ${info.size} members\n${text}`;
          let imgBuf = null;
          try {
            const picUrl = await conn.profilePictureUrl(info.id, 'image');
            const res    = await axios.get(picUrl, { responseType: 'arraybuffer', timeout: 10000 });
            imgBuf = Buffer.from(res.data);
          } catch {}
          if (imgBuf) {
            await conn.sendMessage(from,
              { image: imgBuf, caption, mentions },
              { quoted: standalone ? undefined : mek }
            );
            return;
          }
        }
      } catch {}
    }

    // Plain text — mentions in array, text stays clean
    await conn.sendMessage(from,
      { text, mentions },
      { quoted: standalone ? undefined : sq() }
    );
    return;
  }

  // Media messages — use mek as quoted (NOT vcard, avoids proto crash)
  const buffer = await dlMedia(conn, mek, quoted, qMsg);
  if (!buffer) return reply('❌ Could not download media. Try again.');

  const data    = actualMsg[type];
  // caption: keep original caption, no @text appended (mentions array handles pings)
  const caption = data?.caption || undefined;

  try {
    if (type === 'imageMessage') {
      await conn.sendMessage(from, { image: buffer, caption, mentions }, { quoted: standalone ? undefined : mek });
    } else if (type === 'videoMessage') {
      await conn.sendMessage(from, { video: buffer, caption, mentions, gifPlayback: !!data?.gifPlayback }, { quoted: standalone ? undefined : mek });
    } else if (type === 'audioMessage') {
      await conn.sendMessage(from, { audio: buffer, mimetype: data?.mimetype || 'audio/mp4', ptt: !!data?.ptt }, { quoted: standalone ? undefined : mek });
    } else if (type === 'stickerMessage') {
      await conn.sendMessage(from, { sticker: buffer }, { quoted: standalone ? undefined : mek });
    } else if (type === 'documentMessage') {
      await conn.sendMessage(from, { document: buffer, mimetype: data?.mimetype || 'application/octet-stream', fileName: data?.fileName || 'file', caption: caption || '', mentions }, { quoted: standalone ? undefined : mek });
    }
  } catch (e) {
    reply(`❌ Failed: ${e.message}`);
  }
}

// ── tag ───────────────────────────────────────────────────────────────────────
cast({
  pattern: 'tag',
  desc:    'Resend message/text with silent @all mentions (quoted reply)',
  category: 'group',
  filename: __filename,
}, (conn, mek, m, ctx) => doTag(conn, mek, m, ctx, false));

// ── hidetag ───────────────────────────────────────────────────────────────────
cast({
  pattern: 'hidetag', alias: ['htag', 'silentag'],
  desc:    'Resend message/text with silent @all mentions (standalone, not a reply)',
  category: 'group',
  filename: __filename,
}, (conn, mek, m, ctx) => doTag(conn, mek, m, ctx, true));

'use strict';

const { cast, makeSmartQuote, applyFont } = require('../cast');

const config = require('../config');
const botdb = require('../lib/botdb');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const crypto = require('crypto');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { exec } = require('child_process');
const { getActivityList } = require("../lib/activity");
const { getStats } = require('../lib/groupstats');

// ── GROUP INFO — groupinfo ────────────────────────────
cast({
  pattern: 'groupinfo',
  alias: ['grpinfo', 'groupdetails'],
  desc: 'Show group information',
  category: 'group',
  filename: __filename,
}, async (conn, mek, m, { from, isGroup, groupMetadata, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  try {
    const meta   = groupMetadata;
    const admins = meta.participants.filter(p => p.admin);
    let text = `📋 *GROUP INFORMATION*\n\n`;
    text += `🏷️ Name: ${meta.subject}\n`;
    text += `🆔 ID: ${meta.id}\n`;
    text += `👥 Members: ${meta.participants.length}\n`;
    text += `👑 Admins: ${admins.length}\n`;
    text += `📝 Description: ${meta.desc || 'No description'}\n`;
    text += `🔒 Restricted: ${meta.restrict ? 'Yes' : 'No'}\n`;
    text += `📢 Announce: ${meta.announce ? 'Yes' : 'No'}\n`;
    text += `📅 Created: ${new Date(meta.creation * 1000).toLocaleDateString()}\n\n`;
    text += `👑 *Admins:*\n`;
    admins.forEach((a, i) => { text += `${i+1}. @${a.id.split('@')[0]}\n`; });
    await conn.sendMessage(from, { text, mentions: admins.map(a => a.id) }, { quoted: mek });
  } catch (e) {
    reply(`❌ Error: ${e.message}`);
  }
});

// ── GROUP STATUS ──────────────────────────────────────
// Usage: /groupstatus [text]  OR  reply to image/video/audio + /groupstatus [caption]

// baileys imported at top

const PURPLE = '#9C27B0';

// ─── Media download ───────────────────────────────────────────────────────────

async function downloadFromCtx(conn, mek, mediaType) {
  const ctx = mek.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return null;
  const target = {
    key: { remoteJid: mek.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant },
    message: ctx.quotedMessage,
  };
  return downloadMediaMessage(target, 'buffer', {}, {
    logger: undefined, reuploadRequest: conn.updateMediaMessage
  });
}

async function downloadFromStream(quotedMsg, mediaType) {
  const msgObj = quotedMsg[`${mediaType}Message`] || quotedMsg;
  const stream = await downloadContentFromMessage(msgObj, mediaType);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// ─── Audio → OGG/Opus conversion (toVN) using ffmpeg-static + exec ───────────

function toVN(buffer) {
  return new Promise((resolve, reject) => {
    const inFile  = path.join(os.tmpdir(), `gs_in_${Date.now()}.tmp`);
    const outFile = path.join(os.tmpdir(), `gs_out_${Date.now()}.ogg`);
    fs.writeFileSync(inFile, buffer);
    exec(
      `"${ffmpeg}" -y -i "${inFile}" -vn -c:a libopus -ar 48000 -ac 1 "${outFile}"`,
      (err) => {
        try { fs.unlinkSync(inFile); } catch {}
        if (err) {
          try { fs.unlinkSync(outFile); } catch {}
          return reject(err);
        }
        const out = fs.readFileSync(outFile);
        try { fs.unlinkSync(outFile); } catch {}
        resolve(out);
      }
    );
  });
}

// ─── Waveform generation using ffmpeg-static ─────────────────────────────────

function generateWaveform(buffer, bars = 64) {
  return new Promise((resolve) => {
    const inFile  = path.join(os.tmpdir(), `wf_in_${Date.now()}.tmp`);
    const outFile = path.join(os.tmpdir(), `wf_out_${Date.now()}.raw`);
    fs.writeFileSync(inFile, buffer);
    exec(
      `"${ffmpeg}" -y -i "${inFile}" -ac 1 -ar 16000 -f s16le "${outFile}"`,
      (err) => {
        try { fs.unlinkSync(inFile); } catch {}
        if (err) { try { fs.unlinkSync(outFile); } catch {} return resolve(undefined); }
        try {
          const raw     = fs.readFileSync(outFile);
          try { fs.unlinkSync(outFile); } catch {}
          const samples = raw.length / 2;
          const amps    = [];
          for (let i = 0; i < samples; i++) amps.push(Math.abs(raw.readInt16LE(i * 2)) / 32768);
          const size = Math.floor(amps.length / bars);
          if (size === 0) return resolve(undefined);
          const avg = Array.from({ length: bars }, (_, i) =>
            amps.slice(i * size, (i + 1) * size).reduce((a, b) => a + b, 0) / size
          );
          const max = Math.max(...avg);
          if (max === 0) return resolve(undefined);
          resolve(Buffer.from(avg.map(v => Math.floor((v / max) * 100))).toString('base64'));
        } catch { resolve(undefined); }
      }
    );
  });
}

// ─── Core groupStatus sender ──────────────────────────────────────────────────

async function groupStatus(conn, jid, content) {
  const bgColor = content.backgroundColor || PURPLE;
  const payload = { ...content };
  delete payload.backgroundColor;

  const inside = await generateWAMessageContent(payload, {
    upload: conn.waUploadToServer,
    backgroundColor: bgColor,
  });

  const secret = crypto.randomBytes(32);
  const msg = generateWAMessageFromContent(
    jid,
    {
      messageContextInfo: { messageSecret: secret },
      groupStatusMessageV2: {
        message: { ...inside, messageContextInfo: { messageSecret: secret } },
      },
    },
    {}
  );

  await conn.relayMessage(jid, msg.message, { messageId: msg.key.id });
  return msg;
}

// ─── Command ──────────────────────────────────────────────────────────────────

cast({
  pattern: 'groupstatus',
  alias: ['togstatus', 'swgc', 'gs', 'gstatus'],
  desc: 'Post replied media or text as a WhatsApp Group Status',
  category: 'group',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply, isGroup, isAdmins, isOwner }) => {
  try {
    if (!isGroup) return reply('👥 *Groups only.*');
    if (!isAdmins && !isOwner) return reply('🚫 *Admins only.*');

    const caption = q.trim();
    const ctx = mek.message?.extendedTextMessage?.contextInfo;
    const hasQuoted = !!ctx?.quotedMessage;

    // ── No quoted message → TEXT group status ────────────────────────────────
    if (!hasQuoted) {
      if (!caption) {
        return reply(
          `📝 *Group Status*\n\n` +
          `• Reply to image/video/audio:\n  \`/groupstatus [optional caption]\`\n\n` +
          `• Text status:\n  \`/groupstatus Your text here\`\n\n` +
          `_Text statuses use a purple background._`
        );
      }
      await reply('⏳ Posting text group status...');
      await groupStatus(conn, from, { text: caption, backgroundColor: PURPLE });
      return reply('✅ *Text group status posted!*');
    }

    // ── Quoted message → media group status ──────────────────────────────────
    const mtype = Object.keys(ctx.quotedMessage)[0] || '';

    // IMAGE or STICKER
    if (/image|sticker/i.test(mtype)) {
      await reply('⏳ Posting image group status...');
      const mediaType = /sticker/i.test(mtype) ? 'sticker' : 'image';
      let buf;
      try { buf = await downloadFromCtx(conn, mek, mediaType); } catch {}
      if (!buf) {
        try { buf = await downloadFromStream(ctx.quotedMessage, mediaType); } catch {}
      }
      if (!buf) return reply('❌ Could not download image.');
      await groupStatus(conn, from, { image: buf, caption });
      return reply('✅ *Image group status posted!*');
    }

    // VIDEO
    if (/video/i.test(mtype)) {
      await reply('⏳ Posting video group status...');
      let buf;
      try { buf = await downloadFromCtx(conn, mek, 'video'); } catch {}
      if (!buf) {
        try { buf = await downloadFromStream(ctx.quotedMessage, 'video'); } catch {}
      }
      if (!buf) return reply('❌ Could not download video.');
      await groupStatus(conn, from, { video: buf, caption });
      return reply('✅ *Video group status posted!*');
    }

    // AUDIO
    if (/audio/i.test(mtype)) {
      await reply('⏳ Posting audio group status...');
      let buf;
      try { buf = await downloadFromCtx(conn, mek, 'audio'); } catch {}
      if (!buf) {
        try { buf = await downloadFromStream(ctx.quotedMessage, 'audio'); } catch {}
      }
      if (!buf) return reply('❌ Could not download audio.');

      let vn = buf;
      try { vn = await toVN(buf); } catch {}

      let waveform;
      try { waveform = await generateWaveform(buf); } catch {}

      await groupStatus(conn, from, {
        audio: vn,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
        waveform,
      });
      return reply('✅ *Audio group status posted!*');
    }

    return reply('❌ Unsupported media type. Reply to an image, video, or audio.');
  } catch (e) {
    console.error('groupstatus error:', e.message);
    return reply('❌ Error: ' + e.message);
  }
});

// ── GROUP LINK — invite ───────────────────────────────
cast({
    pattern: "invite",
    desc: "Get group invite link.",
    category: 'group',
    filename: __filename
}, async (conn, mek, m, { isGroup, isAdmins, from, reply }) => {
    try {
        if (!isGroup) return reply("*This command can only be used in groups!*");
        if (!isAdmins) return reply("*I'm not an admin, so I can't generate an invite link!*");

        const groupInviteCode = await conn.groupInviteCode(from);
        const inviteLink = `https://chat.whatsapp.com/${groupInviteCode}`;

        let ppUrl;
        try {
            ppUrl = await conn.profilePictureUrl(from, 'image');
        } catch (err) {
            ppUrl = 'https://files.catbox.moe/49gzva.png'; // Fallback
        }

        return conn.sendMessage(from, {
            image: { url: ppUrl },
            caption: `*Here is the group invite link:*\n\n${inviteLink}`
        }, { quoted: mek });

    } catch (error) {
        console.error(error);
        return reply("*Error fetching the invite link. Please try again later!*");
    }
});

// ── ACTIVITY — tagactive ──────────────────────────────

cast(
  {
    pattern: "tagactive",
    desc: "Mentions the most active members in the group 📊",
    category: 'group',
    filename: __filename,
  },
  async (conn, mek, m, { from, reply, isGroup }) => {
    try {
      if (!isGroup) return reply("🚫 *This command can only be used in groups!*");

      let activeList = getActivityList(from);
      if (activeList.length === 0) return reply("⚠️ *No activity recorded yet!*");

      let topActive = activeList.slice(0, 5); // Get top 5 active users
      let mentions = topActive.map((u) => `🔥 @${u.user.split("@")[0]} (${u.count} msgs)`).join("\n");

      let text = `📊 *Most Active Members:*\n\n${mentions}\n\n🏆 *Stay engaged!*`;

      return await conn.sendMessage(from, { text, mentions: topActive.map((u) => u.user) }, { quoted: mek });
    } catch (e) {
      console.log(e);
      return reply(`❌ *Error:* ${e}`);
    }
  }
);

cast(
  {
    pattern: "listgc",
    desc: "Lists all group members with their message count 📋",
    category: 'group',
    filename: __filename,
  },
  async (conn, mek, m, { from, reply, isGroup }) => {
    try {
      if (!isGroup) return reply("🚫 *This command can only be used in groups!*");

      let activityList = getActivityList(from);
      if (activityList.length === 0) return reply("⚠️ *No messages have been recorded yet!*");

      let list = activityList.map((u, i) => `🔹 *${i + 1}.* @${u.user.split("@")[0]} - ${u.count} msgs`).join("\n");

      let text = `📋 *Group Activity List:*\n\n${list}\n\n💬 *Keep chatting!*`;

      return await conn.sendMessage(from, { text, mentions: activityList.map((u) => u.user) }, { quoted: mek });
    } catch (e) {
      console.log(e);
      return reply(`❌ *Error:* ${e}`);
    }
  }
);

// ── MY ACTIVITY — myactivity ──────────────────────────

cast({
  pattern: 'myactivity',
  alias: ['mystats', 'mymsgs', 'rank'],
  desc: "Check your message activity stats for today",
  category: 'group',
  filename: __filename,
}, async (conn, mek, m, { from, sender, isGroup, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  try {
    const stats = getStats(from);
    if (!stats || !stats.users?.[sender])
      return reply("📊 You haven't sent any messages today yet!");

    const userCount  = stats.users[sender];
    const total      = stats.total;
    const pct        = ((userCount / total) * 100).toFixed(1);
    const sorted     = Object.entries(stats.users).sort((a, b) => b[1] - a[1]);
    const rank       = sorted.findIndex(([id]) => id === sender) + 1;

    await conn.sendMessage(from, {
      text: `📊 *Your Activity Today*\n\n👤 *User:* @${sender.split('@')[0]}\n📝 *Messages:* ${userCount}\n📈 *Share:* ${pct}%\n🏆 *Rank:* #${rank} of ${sorted.length}\n\nKeep chatting! 💬`,
      mentions: [sender]
    }, { quoted: mek });
  } catch (e) {
    console.error('myactivity error:', e);
    reply('❌ Error loading activity stats.');
  }
});

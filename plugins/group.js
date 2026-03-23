'use strict';
const { cast, makeSmartQuote, applyFont } = require('../cast');

const { jidNormalizedUser } = require("@whiskeysockets/baileys");
const { lidToPhone } = require("../lib/lid");
const axios = require("axios");

// ─────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────

const extractMentions = (m, mek) => {
  try { if (Array.isArray(m?.mentions) && m.mentions.length) return m.mentions; } catch {}
  try { if (Array.isArray(m?.mentionedJid) && m.mentionedJid.length) return m.mentionedJid; } catch {}
  try {
    for (const t of ['extendedTextMessage','imageMessage','videoMessage','documentMessage']) {
      const ctx = mek?.message?.[t]?.contextInfo;
      if (ctx && Array.isArray(ctx.mentionedJid) && ctx.mentionedJid.length) return ctx.mentionedJid;
    }
  } catch {}
  return [];
};

const short = (jid) => (typeof jid === "string" ? jid.split("@")[0].split(":")[0] : String(jid));

// Resolve target JID — supports @mention, reply, plain number, or @lid
// Pass participants array to get the exact JID WhatsApp expects (required for promote/demote)
const resolveTarget = async (conn, m, mek, args, q, participants) => {
  let target = null;
  const mentions = extractMentions(m, mek);

  if (mentions.length > 0) {
    target = mentions[0];
  } else if (m.quoted && m.quoted.sender) {
    target = m.quoted.sender;
  } else {
    const raw = (args[0] || q || '').toString().replace(/[^0-9]/g, '');
    if (raw.length >= 7) target = raw + '@s.whatsapp.net';
  }

  if (!target) return null;

  // Resolve LID → real phone number
  if (target.endsWith('@lid')) {
    const resolved = await lidToPhone(conn, target);
    target = resolved.includes('@') ? resolved : resolved + '@s.whatsapp.net';
  }

  // Get digits-only version for matching
  const targetDigits = target.split('@')[0].split(':')[0].replace(/\D/g, '');

  // If participants provided, find the exact JID from the group list
  // This is critical for promote/demote which need the exact JID WhatsApp has on record
  if (participants && participants.length) {
    const match = participants.find(p => {
      const pDigits = (p.id || '').split('@')[0].split(':')[0].replace(/\D/g, '');
      return pDigits === targetDigits;
    });
    if (match) return match.id;
  }

  try { return jidNormalizedUser(target); } catch { return target; }
};

// Get a display name for a JID from group participants list
const getDisplayName = (jid, participants) => {
  const digitsOnly = short(jid);
  // participants may have verifiedName or name
  const p = (participants || []).find(x => short(x.id) === digitsOnly);
  return p?.verifiedName || p?.name || p?.notify || digitsOnly;
};

// ─────────────────────────────────────────────────────────────────────
// SCHEDULE STORE  (in-memory, survives plugin reloads within same process)
// ─────────────────────────────────────────────────────────────────────
if (!global._gcSchedules) global._gcSchedules = new Map(); // jid -> { openJob, closeJob }

function clearSchedule(jid) {
  const existing = global._gcSchedules.get(jid);
  if (existing) {
    if (existing.openTimer)  clearTimeout(existing.openTimer);
    if (existing.closeTimer) clearTimeout(existing.closeTimer);
    if (existing.openJob)    try { existing.openJob.stop(); } catch {}
    if (existing.closeJob)   try { existing.closeJob.stop(); } catch {}
    global._gcSchedules.delete(jid);
  }
}

// Parse user input — supports "19:00" (daily cron) or "30min" / "2h" (one-shot delay)
// Returns { type: 'cron'|'delay', value: cronString|ms, label: humanReadable }
function parseTimeInput(input) {
  const str = input.trim().toLowerCase();

  // Duration: 30min, 2h, 90s
  const minMatch = str.match(/^(\d+)\s*min$/);
  const hrMatch  = str.match(/^(\d+)\s*h(r|ours?)?$/);
  const secMatch  = str.match(/^(\d+)\s*s(ec|econds?)?$/);
  if (minMatch) return { type: 'delay', value: parseInt(minMatch[1]) * 60000, label: `${minMatch[1]} minute(s)` };
  if (hrMatch)  return { type: 'delay', value: parseInt(hrMatch[1])  * 3600000, label: `${hrMatch[1]} hour(s)` };
  if (secMatch) return { type: 'delay', value: parseInt(secMatch[1]) * 1000,    label: `${secMatch[1]} second(s)` };

  // Time: 19:00 or 7:00pm or 19:00
  const timeMatch = str.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (timeMatch) {
    let h = parseInt(timeMatch[1]);
    const min = parseInt(timeMatch[2]);
    const ampm = timeMatch[3];
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    // Build cron: "MM HH * * *"
    const cronStr = `${min} ${h} * * *`;
    const label = `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')} daily`;
    return { type: 'cron', value: cronStr, label };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────
// MODERATION
// ─────────────────────────────────────────────────────────────────────

cast({
  pattern: "kick",
  desc: "Kicks a member from the group",
  category: "group",
  filename: __filename,
}, async (conn, mek, m, { from, args, q, reply, isGroup, isAdmins, isOwner, participants }) => {
  try {
    if (!isGroup) return reply("🚫 *Groups only!*");
    if (!isAdmins && !isOwner) return reply("⚠️ *You need admin permissions.*");

    const target = await resolveTarget(conn, m, mek, args, q, participants);
    if (!target) return reply("_Tag a user, reply to their message, or type their number (e.g. /kick 2348012345678)._");
    if (target.includes("2348084644182")) return reply("😂 *I'm not kicking my creator!*");

    const name = getDisplayName(target, participants);
    await conn.groupParticipantsUpdate(from, [target], "remove");
    return conn.sendMessage(from, {
      text: `👢 *${name}* has been removed from the group.`,
      mentions: [target]
    }, { quoted: mek });
  } catch (e) {
    reply("❌ *Failed to kick.* I may need admin rights in this group.");
  }
});

cast({
  pattern: "add",
  desc: "Adds a person to the group",
  category: "group",
  filename: __filename,
}, async (conn, mek, m, { from, args, q, reply, isGroup, isAdmins, isOwner }) => {
  try {
    if (!isGroup) return reply("🚫 *Groups only!*");
    if (!isAdmins && !isOwner) return reply("⚠️ *Admin only.*");

    const target = await resolveTarget(conn, m, mek, args, q);
    if (!target) return reply("_Type a number to add (e.g. /add 2348012345678)._");

    await conn.groupParticipantsUpdate(from, [target], "add");
    return conn.sendMessage(from, {
      text: `✅ @${short(target)} *has been added to the group!*`,
      mentions: [target]
    }, { quoted: mek });
  } catch (e) {
    reply("❌ *Failed to add.* User may have privacy settings or I need admin rights.");
  }
});

cast({
  pattern: "promote",
  desc: "Promotes a member to admin",
  category: "group",
  filename: __filename,
}, async (conn, mek, m, { from, args, q, reply, isGroup, isAdmins, isOwner, participants }) => {
  try {
    if (!isGroup || (!isAdmins && !isOwner)) return reply("🚫 *Admins only.*");

    const target = await resolveTarget(conn, m, mek, args, q, participants);
    if (!target) return reply("_Tag someone or type their number to promote._");

    const name = getDisplayName(target, participants);
    await conn.groupParticipantsUpdate(from, [target], "promote");
    return conn.sendMessage(from, {
      text: `⭐ *${name}* has been promoted to admin!`,
      mentions: [target]
    }, { quoted: mek });
  } catch (e) { reply("❌ *Failed to promote.* I may need admin rights."); }
});

cast({
  pattern: "demote",
  desc: "Demotes an admin to member",
  category: "group",
  filename: __filename,
}, async (conn, mek, m, { from, args, q, reply, isGroup, isAdmins, isOwner, participants }) => {
  try {
    if (!isGroup || (!isAdmins && !isOwner)) return reply("🚫 *Admins only.*");

    const target = await resolveTarget(conn, m, mek, args, q, participants);
    if (!target) return reply("_Tag someone or type their number to demote._");

    const name = getDisplayName(target, participants);
    await conn.groupParticipantsUpdate(from, [target], "demote");
    return conn.sendMessage(from, {
      text: `📉 *${name}* has been demoted to member.`,
      mentions: [target]
    }, { quoted: mek });
  } catch (e) { reply("❌ *Failed to demote.* I may need admin rights."); }
});

// ─────────────────────────────────────────────────────────────────────
// TAGGING
// ─────────────────────────────────────────────────────────────────────

cast({
  pattern: "tagall",
  alias: ["mentionall"],
  desc: "Mentions everyone in the group",
  category: "group",
  filename: __filename,
}, async (conn, mek, m, { from, reply, isGroup, groupMetadata, groupName, sender, q, isAdmins, isOwner }) => {
  try {
    if (!isGroup || (!isAdmins && !isOwner)) return reply("🚫 *Admins only.*");

    const participants = groupMetadata.participants || [];
    const mentions = participants.map((p) => p.id);
    const admins = participants.filter(p => p.admin).map(p => p.id);
    const members = participants.filter(p => !p.admin).map(p => p.id);
    const message = q || "📢 Attention everyone!";
    const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    let text = `┏━━━━━━━━━━━━━━━━━━━━┓\n`;
    text += `┃  👑 *NEXUS-MD TAGALL* 👑\n`;
    text += `┗━━━━━━━━━━━━━━━━━━━━┛\n\n`;
    text += `📌 *Group:* ${groupName || 'Unknown'}\n`;
    text += `👤 *By:* @${short(sender)}\n`;
    text += `🕐 *Time:* ${now}\n`;
    text += `📊 *Members:* ${participants.length} (${admins.length} admins)\n\n`;
    text += `💬 *Message:*\n${message}\n\n`;

    if (admins.length > 0) {
      text += `━━━━ 👑 *ADMINS* ━━━━\n`;
      admins.forEach(jid => { text += `  ┣ @${short(jid)}\n`; });
      text += `\n`;
    }

    text += `━━━━ 👥 *MEMBERS* ━━━━\n`;
    members.forEach(jid => { text += `  ┣ @${short(jid)}\n`; });
    text += `\n┗━━━━━━━━━━━━━━━━━━━━┛`;

    return await conn.sendMessage(from, { text, mentions }, { quoted: mek });
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});


// ─────────────────────────────────────────────────────────────────────
// TAG — mention specific user with optional message.
// If the body/quoted contains a WhatsApp group invite link,
// fetches the group DP and sends it as an image with the tag.
// ─────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────
// SCHEDULE OPEN / CLOSE
// ─────────────────────────────────────────────────────────────────────

cast({
  pattern: "scheduleopen",
  alias: ["setopen", "openat"],
  desc: "Schedule group to open at a time or after a delay. e.g. /scheduleopen 19:00 or /scheduleopen 30min",
  category: "group",
  filename: __filename,
}, async (conn, mek, m, { from, q, reply, isGroup, isAdmins, isOwner }) => {
  if (!isGroup || (!isAdmins && !isOwner)) return reply("🚫 *Admins only.*");
  if (!q) return reply(
    `*⏰ Schedule Group Open*\n\n` +
    `Usage:\n` +
    `• \`/scheduleopen 19:00\` — open daily at 7 PM\n` +
    `• \`/scheduleopen 30min\` — open after 30 minutes\n` +
    `• \`/scheduleopen 2h\` — open after 2 hours`
  );

  const parsed = parseTimeInput(q);
  if (!parsed) return reply("❌ Invalid format. Use `19:00`, `30min`, or `2h`.");

  if (parsed.type === 'delay') {
    const timer = setTimeout(async () => {
      try {
        await conn.groupSettingUpdate(from, "not_announcement");
        await conn.sendMessage(from, { text: `🔓 *Group is now open!*\nEveryone can send messages.` }, { quoted: mek });
      } catch {}
    }, parsed.value);

    // Store timer
    const existing = global._gcSchedules.get(from) || {};
    if (existing.openTimer) clearTimeout(existing.openTimer);
    existing.openTimer = timer;
    global._gcSchedules.set(from, existing);

    return reply(`✅ *Group open scheduled!*\nWill open in *${parsed.label}*.`);

  } else {
    // Cron
    let cron;
    try { cron = require('node-cron'); } catch { return reply("❌ node-cron not installed."); }
    if (!cron.validate(parsed.value)) return reply("❌ Invalid time format.");

    const existing = global._gcSchedules.get(from) || {};
    if (existing.openJob) try { existing.openJob.stop(); } catch {}

    existing.openJob = cron.schedule(parsed.value, async () => {
      try {
        await conn.groupSettingUpdate(from, "not_announcement");
        await conn.sendMessage(from, { text: `🔓 *Group is now open!* _(Scheduled)_` }, { quoted: mek });
      } catch {}
    }, { scheduled: true, timezone: "Africa/Lagos" });

    global._gcSchedules.set(from, existing);
    return reply(`✅ *Group open scheduled daily at ${parsed.label}!*\nUse /cancelschedule to remove.`);
  }
});

cast({
  pattern: "scheduleclose",
  alias: ["setclose", "closeat"],
  desc: "Schedule group to close at a time or after a delay. e.g. /scheduleclose 23:00 or /scheduleclose 1h",
  category: "group",
  filename: __filename,
}, async (conn, mek, m, { from, q, reply, isGroup, isAdmins, isOwner }) => {
  if (!isGroup || (!isAdmins && !isOwner)) return reply("🚫 *Admins only.*");
  if (!q) return reply(
    `*⏰ Schedule Group Close*\n\n` +
    `Usage:\n` +
    `• \`/scheduleclose 23:00\` — close daily at 11 PM\n` +
    `• \`/scheduleclose 30min\` — close after 30 minutes\n` +
    `• \`/scheduleclose 2h\` — close after 2 hours`
  );

  const parsed = parseTimeInput(q);
  if (!parsed) return reply("❌ Invalid format. Use `23:00`, `30min`, or `2h`.");

  if (parsed.type === 'delay') {
    const timer = setTimeout(async () => {
      try {
        await conn.groupSettingUpdate(from, "announcement");
        await conn.sendMessage(from, { text: `🔒 *Group is now closed!*\nOnly admins can send messages.` }, { quoted: mek });
      } catch {}
    }, parsed.value);

    const existing = global._gcSchedules.get(from) || {};
    if (existing.closeTimer) clearTimeout(existing.closeTimer);
    existing.closeTimer = timer;
    global._gcSchedules.set(from, existing);

    return reply(`✅ *Group close scheduled!*\nWill close in *${parsed.label}*.`);

  } else {
    let cron;
    try { cron = require('node-cron'); } catch { return reply("❌ node-cron not installed."); }
    if (!cron.validate(parsed.value)) return reply("❌ Invalid time format.");

    const existing = global._gcSchedules.get(from) || {};
    if (existing.closeJob) try { existing.closeJob.stop(); } catch {}

    existing.closeJob = cron.schedule(parsed.value, async () => {
      try {
        await conn.groupSettingUpdate(from, "announcement");
        await conn.sendMessage(from, { text: `🔒 *Group is now closed!* _(Scheduled)_` }, { quoted: mek });
      } catch {}
    }, { scheduled: true, timezone: "Africa/Lagos" });

    global._gcSchedules.set(from, existing);
    return reply(`✅ *Group close scheduled daily at ${parsed.label}!*\nUse /cancelschedule to remove.`);
  }
});

cast({
  pattern: "cancelschedule",
  alias: ["unschedule", "clearschedule"],
  desc: "Cancel all scheduled open/close for this group",
  category: "group",
  filename: __filename,
}, async (conn, mek, m, { from, reply, isGroup, isAdmins, isOwner }) => {
  if (!isGroup || (!isAdmins && !isOwner)) return reply("🚫 *Admins only.*");
  if (!global._gcSchedules.has(from)) return reply("ℹ️ No schedule is set for this group.");
  clearSchedule(from);
  return reply("🗑️ *All schedules for this group have been cancelled.*");
});

cast({
  pattern: "schedulestatus",
  alias: ["scheduleinfo"],
  desc: "Check if a schedule is active for this group",
  category: "group",
  filename: __filename,
}, async (conn, mek, m, { from, reply, isGroup, isAdmins, isOwner }) => {
  if (!isGroup || (!isAdmins && !isOwner)) return reply("🚫 *Admins only.*");
  const s = global._gcSchedules.get(from);
  if (!s) return reply("ℹ️ *No active schedule* for this group.");
  const lines = [`⏰ *Active Schedules:*\n`];
  if (s.openJob || s.openTimer) lines.push(`✅ Open: *set*`);
  if (s.closeJob || s.closeTimer) lines.push(`✅ Close: *set*`);
  lines.push(`\nUse /cancelschedule to remove.`);
  return reply(lines.join('\n'));
});

// ─────────────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────────────

cast({
  pattern: "mute",
  desc: "Mutes the group (only admins can send)",
  category: "group",
  filename: __filename,
}, async (conn, mek, m, { from, reply, isGroup, isAdmins, isOwner }) => {
  if (!isGroup || (!isAdmins && !isOwner)) return reply("🚫 *Admins only.*");
  try {
    await conn.groupSettingUpdate(from, "announcement");
    reply("🔇 *Group muted.* Only admins can send messages.");
  } catch (e) { reply("❌ Failed. I may need admin rights."); }
});

cast({
  pattern: "unmute",
  desc: "Unmutes the group",
  category: "group",
  filename: __filename,
}, async (conn, mek, m, { from, reply, isGroup, isAdmins, isOwner }) => {
  if (!isGroup || (!isAdmins && !isOwner)) return reply("🚫 *Admins only.*");
  try {
    await conn.groupSettingUpdate(from, "not_announcement");
    reply("🔊 *Group unmuted.* Everyone can send messages.");
  } catch (e) { reply("❌ Failed. I may need admin rights."); }
});

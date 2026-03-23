'use strict';

const { cast, makeSmartQuote, applyFont } = require('../cast');
const config = require('../config');
const { lidToPhone } = require('../lib/lid');
const axios = require('axios');

// ── GROUP SETTINGS — ginfo/setdesc/setgname/gpp/lock/unlock/kik/num/poll/ship 

const P = config.PREFIX || '/';

// ── ginfo ─────────────────────────────────────────────────────────────
cast({
  pattern: 'ginfo',
  desc: 'Get group info from an invite link',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    const match = (q || '').match(/https:\/\/chat\.whatsapp\.com\/([A-Za-z0-9]{22})/);
    if (!match) return reply(`*Provide a valid WhatsApp group link!*\nExample: ${P}ginfo https://chat.whatsapp.com/...`);
    const info = await conn.groupGetInviteInfo(match[1]);
    if (!info) return reply('*Group not found or link has expired.*');
    const created = new Date(info.creation * 1000).toISOString().split('T')[0];
    await conn.sendMessage(from, {
      text: `👥 *${info.subject}*\n\n` +
            `👤 *Creator:* wa.me/${(info.owner || '').split('@')[0]}\n` +
            `🆔 *JID:* ${info.id}\n` +
            `🔇 *Muted:* ${info.announce ? 'Yes' : 'No'}\n` +
            `🔒 *Locked:* ${info.restrict ? 'Yes' : 'No'}\n` +
            `📅 *Created:* ${created}\n` +
            `👥 *Members:* ${info.size}` +
            (info.desc ? `\n📝 *Description:* ${info.desc}` : '') +
            `\n\n🔗 ${match[0]}`
    }, { quoted: mek });
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── setdesc ───────────────────────────────────────────────────────────
cast({
  pattern: 'setdesc',
  alias: ['setgdesc', 'gdesc'],
  desc: 'Set the group description',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, q, isGroup, isAdmins, isBotAdmins, isOwner, reply }) => {
  try {
    if (!isGroup) return reply('*Groups only!*');
    if (!isAdmins && !isOwner) return reply('*Admins only!*');
    if (!isBotAdmins) return reply('*I need admin rights first!*');
    if (!q) return reply(`*Example:* ${P}setdesc Welcome to the group!`);
    await conn.groupUpdateDescription(from, q);
    reply('✅ *Group description updated!*');
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── setgname ──────────────────────────────────────────────────────────
cast({
  pattern: 'setgname',
  alias: ['setname', 'gname'],
  desc: 'Set the group name',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, q, isGroup, isAdmins, isBotAdmins, isOwner, reply }) => {
  try {
    if (!isGroup) return reply('*Groups only!*');
    if (!isAdmins && !isOwner) return reply('*Admins only!*');
    if (!isBotAdmins) return reply('*I need admin rights first!*');
    if (!q) return reply(`*Example:* ${P}setgname My Group Name`);
    await conn.groupUpdateSubject(from, q);
    reply('✅ *Group name updated!*');
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── gpp ───────────────────────────────────────────────────────────────
cast({
  pattern: 'gpp',
  desc: 'Set the group profile picture (reply to an image)',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, isAdmins, isBotAdmins, isOwner, reply }) => {
  try {
    if (!isGroup) return reply('*Groups only!*');
    if (!isAdmins && !isOwner) return reply('*Admins only!*');
    if (!isBotAdmins) return reply('*I need admin rights first!*');
    if (!m.quoted) return reply('*Reply to an image!*');
    // Use m.quoted.getbuff — the correct platinum download method
    let buf;
    try { buf = await m.quoted.getbuff; } catch {}
    if (!buf) try { buf = await m.quoted.download(); } catch {}
    if (!buf) return reply('*Could not download the image. Make sure you reply to an image.*');
    await conn.updateProfilePicture(from, buf);
    reply('✅ *Group picture updated!*');
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── lock / unlock ─────────────────────────────────────────────────────
cast({
  pattern: 'lock',
  desc: 'Lock group settings to admins only',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, isAdmins, isBotAdmins, isOwner, reply }) => {
  try {
    if (!isGroup) return reply('*Groups only!*');
    if (!isAdmins && !isOwner) return reply('*Admins only!*');
    if (!isBotAdmins) return reply('*I need admin rights first!*');
    await conn.groupSettingUpdate(from, 'locked');
    reply('🔒 *Group locked! Only admins can change group settings.*');
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});


// ── kik ───────────────────────────────────────────────────────────────
cast({
  pattern: 'kik',
  desc: 'Kick all members from a specific country code',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, q, isGroup, isAdmins, isOwner, groupMetadata, reply }) => {
  try {
    if (!isGroup) return reply('*Groups only!*');
    if (!isAdmins && !isOwner) return reply('*Admins only!*');
    
    let cc = (q || '').replace(/[^0-9]/g, '');
    if (!cc) return reply(`*Provide a valid country code!*\nExample: ${P}kik 234`);
    
    const participants = groupMetadata?.participants || [];
    if (participants.length === 0) return reply(`*Error:* Group participant list is empty.`);
    
    const botJid = conn.user.id.split(':')[0];

    reply(`⏳ *Scanning ${participants.length} members for +${cc}. This might take a moment...*`);
    
    let targets = [];
    
    // Check every participant, decoding LIDs if necessary
    for (const p of participants) {
        let originalId = p.id || p.jid;
        let checkNumber = originalId;

        // If it's a hidden LID, decrypt it to the real phone number
        if (originalId.includes('@lid')) {
            checkNumber = await lidToPhone(conn, originalId);
        }

        // Clean up the number
        checkNumber = checkNumber.split('@')[0].split(':')[0];
        const isAdmin = p.admin === 'admin' || p.admin === 'superadmin';

        // Check if the real number starts with the country code
        if (checkNumber.startsWith(cc) && !isAdmin && checkNumber !== botJid) {
            targets.push(originalId); // Push the original ID so WhatsApp knows who to kick
        }
    }

    if (targets.length === 0) {
        return reply(`*No non-admin members found matching country code +${cc}!*`);
    }

    reply(`⏳ *Found ${targets.length} member(s) with +${cc}. Kicking now...*`);
    
    let kicked = 0;
    for (const jid of targets) {
      try { 
          await conn.groupParticipantsUpdate(from, [jid], 'remove'); 
          kicked++; 
          await new Promise(res => setTimeout(res, 1000)); // Anti-ban delay
      } catch (err) {
          console.error(`Failed to kick ${jid}:`, err);
      }
    }
    
    reply(`✅ *Successfully kicked ${kicked}/${targets.length} member(s) with +${cc}!*`);
  } catch (e) { 
    console.error(e);
    reply(`❌ Error: Failed to process command. Ensure the bot is an admin.`); 
  }
});

// ── num ───────────────────────────────────────────────────────────────
cast({
  pattern: 'num',
  desc: 'List all members from a specific country code',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, q, isGroup, isAdmins, isOwner, groupMetadata, reply }) => {
  try {
    if (!isGroup) return reply('*Groups only!*');
    if (!isAdmins && !isOwner) return reply('*Admins only!*');
    
    let cc = (q || '').replace(/[^0-9]/g, '');
    if (!cc) return reply(`*Provide a valid country code!*\nExample: ${P}num 234`);
    
    const participants = groupMetadata?.participants || [];
    if (participants.length === 0) return reply(`*Error:* Group participant list is empty.`);
    

    reply(`⏳ *Scanning members for +${cc}...*`);
    
    let found = [];
    
    // Decode and check everyone
    for (const p of participants) {
        let originalId = p.id || p.jid;
        let checkNumber = originalId;

        if (originalId.includes('@lid')) {
            checkNumber = await lidToPhone(conn, originalId);
        }

        checkNumber = checkNumber.split('@')[0].split(':')[0];

        if (checkNumber.startsWith(cc)) {
            found.push(checkNumber);
        }
    }

    if (found.length === 0) {
        return reply(`*No members found matching country code +${cc}!*`);
    }
    
    let txt = `📋 *Members with +${cc} (${found.length}):*\n\n`;
    found.forEach((num, i) => { 
        txt += `${i + 1}. wa.me/${num}\n`; 
    });
    
    await conn.sendMessage(from, { text: txt }, { quoted: mek });
  } catch (e) { 
    reply(`❌ Error: ${e.message}`); 
  }
});

// ── poll ──────────────────────────────────────────────────────────────
cast({
  pattern: 'poll',
  desc: 'Create a poll. Usage: /poll Question;Option1,Option2,Option3',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, q, isGroup, reply }) => {
  try {
    if (!isGroup) return reply('*Groups only!*');
    if (!q || !q.includes(';')) return reply(`*Example:* ${P}poll Best food?;Pizza,Burger,Pasta`);
    const [question, optStr] = q.split(';');
    const values = optStr.split(',').map(o => o.trim()).filter(Boolean);
    if (values.length < 2) return reply('*Provide at least 2 options!*');
    await conn.sendMessage(from, { poll: { name: question.trim(), values } });
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── ship ──────────────────────────────────────────────────────────────
cast({
  pattern: 'ship',
  desc: 'Matchmake yourself with a random or mentioned member',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, sender, isGroup, participants, reply }) => {
  try {
    if (!isGroup) return reply('*Groups only!*');
    // get mentioned or quoted target
    let target = m.quoted?.sender || null;
    if (!target) {
      try {
        for (const t of ['extendedTextMessage','imageMessage']) {
          const ctx = mek?.message?.[t]?.contextInfo;
          if (ctx?.mentionedJid?.[0]) { target = ctx.mentionedJid[0]; break; }
        }
      } catch {}
    }
    if (!target) {
      const others = participants.map(p => p.id).filter(id => id !== sender);
      target = others[Math.floor(Math.random() * others.length)];
    }
    if (sender === target) return reply('*You want to match with yourself? 😂*');
    const pct = Math.floor(Math.random() * 100);
    let note;
    if (pct < 25)      note = 'Still time to reconsider... 😅';
    else if (pct < 50) note = 'Not bad, I guess! 💫';
    else if (pct < 75) note = 'Stay together! ⭐';
    else if (pct < 90) note = 'You two will make a great couple 💖';
    else               note = 'Perfect match! 💙';
    await conn.sendMessage(from, {
      text: `❣️ *Matchmaking...*\n\n@${sender.split('@')[0]} ❤️ @${target.split('@')[0]}\n\n💯 *${pct}%* — ${note}`,
      mentions: [sender, target]
    }, { quoted: mek });
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── tagadmin ──────────────────────────────────────────────────────────
cast({
  pattern: 'tagadmin',
  desc: 'Tag all group admins',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, q, isGroup, isAdmins, isOwner, groupAdmins, reply }) => {
  try {
    if (!isGroup) return reply('*Groups only!*');
    if (!isAdmins && !isOwner) return reply('*Admins only!*');
    if (!groupAdmins?.length) return reply('*No admins found!*');
    let txt = `*👑 GROUP ADMINS*\n\n${q ? `📢 *Message:* ${q}\n\n` : ''}`;
    groupAdmins.forEach((id, i) => { txt += `${i + 1}. @${id.split('@')[0]}\n`; });
    await conn.sendMessage(from, { text: txt, mentions: groupAdmins }, { quoted: mek });
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── attention ─────────────────────────────────────────────────────────
cast({
  pattern: 'attention',
  react: '👸',
  desc: 'Tag everyone with a royal message',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, q, isGroup, isAdmins, isOwner, participants, pushname, reply }) => {
  try {
    if (!isGroup) return reply('*Groups only!*');
    if (!isAdmins && !isOwner) return reply('*Admins only!*');
    let txt = `🌟👑 *ROYAL GATHERING* 👑🌟\n\n` +
              `🎉 *Attention, esteemed members!*\n` +
              `✨ You are cordially invited to join the royal assembly!\n\n` +
              `➲ *Message:* ${q || 'No special message.'}\n` +
              `🛡️ *By:* ${pushname} 🔖\n\n👥 *Participants:*\n`;
    const ids = participants.map(p => p.id);
    ids.forEach(id => { txt += `🍀 @${id.split('@')[0]}\n`; });
    txt += '\n✨ Thank you for your presence! 🎊👑';
    await conn.sendMessage(from, { text: txt, mentions: ids }, { quoted: mek });
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── broadcastall ──────────────────────────────────────────────────────
cast({
  pattern: 'broadcastall',
  desc: 'Broadcast a message to all groups (owner only)',
  category: 'group',
  fromMe: true,
  filename: __filename
}, async (conn, mek, m, { q, isOwner, reply }) => {
  try {
    if (!isOwner) return reply('*Owner only!*');
    if (!q) return reply(`*Example:* ${P}broadcastall Hello everyone!`);
    const groups = await conn.groupFetchAllParticipating();
    const ids = Object.keys(groups);
    reply(`📡 *Broadcasting to ${ids.length} groups...*`);
    let sent = 0;
    for (const id of ids) {
      try { await conn.sendMessage(id, { text: `📢 *BROADCAST*\n\n${q}` }, { quoted: mek }); sent++; } catch {}
    }
    reply(`✅ *Broadcast sent to ${sent}/${ids.length} groups!*`);
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── getjids ───────────────────────────────────────────────────────────
cast({
  pattern: 'getjids',
  alias: ['gjid', 'allgc', 'gclist'],
  desc: 'List all group JIDs and names (owner only)',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, q, isOwner, reply }) => {
  try {
    if (!isOwner) return reply('*Owner only!*');
    const groups  = await conn.groupFetchAllParticipating();
    const entries = Object.entries(groups);
    const onlyJids  = (q || '').includes('jid');
    const onlyNames = (q || '').includes('name');
    let txt = `📋 *All Groups (${entries.length})*\n\n`;
    for (const [id, meta] of entries) {
      if (!onlyJids)  txt += `*Group:* ${meta.subject}  `;
      if (!onlyNames) txt += `*JID:* ${id}`;
      txt += '\n';
    }
    await conn.sendMessage(from, { text: txt }, { quoted: mek });
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── rejectall ─────────────────────────────────────────────────────────
cast({
  pattern: 'rejectall',
  alias: ['rejectjoin'],
  desc: 'Reject all pending join requests',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, isAdmins, isBotAdmins, isOwner, reply }) => {
  try {
    if (!isGroup) return reply('*Groups only!*');
    if (!isAdmins && !isOwner) return reply('*Admins only!*');
    if (!isBotAdmins) return reply('*I need admin rights first!*');
    const list = await conn.groupRequestParticipantsList(from);
    if (!list?.length) return reply('*No pending join requests!*');
    const jids = [];
    for (const req of list) {
      try { await conn.groupRequestParticipantsUpdate(from, [req.jid], 'reject'); jids.push(req.jid); } catch {}
    }
    let txt = `✅ *Rejected ${jids.length} join request(s):*\n`;
    jids.forEach(jid => { txt += `• @${jid.split('@')[0]}\n`; });
    await conn.sendMessage(from, { text: txt, mentions: jids }, { quoted: mek });
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── acceptall ─────────────────────────────────────────────────────────
cast({
  pattern: 'acceptall',
  alias: ['acceptjoin'],
  desc: 'Accept all pending join requests',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, isAdmins, isBotAdmins, isOwner, reply }) => {
  try {
    if (!isGroup) return reply('*Groups only!*');
    if (!isAdmins && !isOwner) return reply('*Admins only!*');
    if (!isBotAdmins) return reply('*I need admin rights first!*');
    const list = await conn.groupRequestParticipantsList(from);
    if (!list?.length) return reply('*No pending join requests!*');
    const jids = [];
    for (const req of list) {
      try { await conn.groupRequestParticipantsUpdate(from, [req.jid], 'approve'); jids.push(req.jid); } catch {}
    }
    let txt = `✅ *Accepted ${jids.length} join request(s):*\n`;
    jids.forEach(jid => { txt += `• @${jid.split('@')[0]}\n`; });
    await conn.sendMessage(from, { text: txt, mentions: jids }, { quoted: mek });
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── listrequest ───────────────────────────────────────────────────────
cast({
  pattern: 'listrequest',
  alias: ['requestjoin'],
  desc: 'List all pending join requests',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, isAdmins, isBotAdmins, isOwner, reply }) => {
  try {
    if (!isGroup) return reply('*Groups only!*');
    if (!isAdmins && !isOwner) return reply('*Admins only!*');
    if (!isBotAdmins) return reply('*I need admin rights first!*');
    const list = await conn.groupRequestParticipantsList(from);
    if (!list?.length) return reply('*No pending join requests!*');
    const jids = list.map(r => r.jid);
    let txt = `📋 *Pending Join Requests (${jids.length}):*\n\n`;
    jids.forEach((jid, i) => { txt += `${i + 1}. @${jid.split('@')[0]}\n`; });
    await conn.sendMessage(from, { text: txt, mentions: jids }, { quoted: mek });
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── pick ──────────────────────────────────────────────────────────────
cast({
  pattern: 'pick',
  desc: 'Pick a random group member',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, q, isGroup, participants, reply }) => {
  try {
    if (!isGroup) return reply('*Groups only!*');
    if (!q) return reply(`*What type of person?*\nExample: ${P}pick most active`);
    const ids    = participants.map(p => p.id);
    const picked = ids[Math.floor(Math.random() * ids.length)];
    await conn.sendMessage(from, {
      text: `🎯 The most *${q}* person around us is @${picked.split('@')[0]}!`,
      mentions: [picked]
    }, { quoted: mek });
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── common ────────────────────────────────────────────────────────────
cast({
  pattern: 'common',
  desc: 'Find common members between two groups (owner only)',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, q, isOwner, reply }) => {
  try {
    if (!isOwner) return reply('*Owner only!*');
    const jids = (q || '').match(/\d+@g\.us/g);
    if (!jids || jids.length < 2) return reply(`*Provide 2 group JIDs!*\nExample: ${P}common 123@g.us 456@g.us`);
    const [g1, g2] = await Promise.all([conn.groupMetadata(jids[0]), conn.groupMetadata(jids[1])]);
    const common = g1.participants.filter(p => g2.participants.some(p2 => p2.id === p.id));
    if (!common.length) return reply('*No common members found!*');
    const ids = common.map(p => p.id);
    let txt = `🔗 *Common Members (${ids.length})*\n*${g1.subject}* ↔ *${g2.subject}*\n\n`;
    ids.forEach((id, i) => { txt += `${i + 1}. @${id.split('@')[0]}\n`; });
    await conn.sendMessage(from, { text: txt, mentions: ids }, { quoted: mek });
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── diff ──────────────────────────────────────────────────────────────
cast({
  pattern: 'diff',
  desc: 'Members in group 1 but not in group 2 (owner only)',
  category: 'group',
  filename: __filename
}, async (conn, mek, m, { from, q, isOwner, reply }) => {
  try {
    if (!isOwner) return reply('*Owner only!*');
    const jids = (q || '').match(/\d+@g\.us/g);
    if (!jids || jids.length < 2) return reply(`*Provide 2 group JIDs!*`);
    const [g1, g2] = await Promise.all([conn.groupMetadata(jids[0]), conn.groupMetadata(jids[1])]);
    const diff = g1.participants.filter(p => !g2.participants.some(p2 => p2.id === p.id));
    if (!diff.length) return reply('*No unique members found!*');
    const ids = diff.map(p => p.id);
    let txt = `📊 *Members only in "${g1.subject}" (${ids.length}):*\n\n`;
    ids.forEach((id, i) => { txt += `${i + 1}. @${id.split('@')[0]}\n`; });
    await conn.sendMessage(from, { text: txt, mentions: ids }, { quoted: mek });
  } catch (e) { reply(`❌ Error: ${e.message}`); }
});

// ── GROUP TOOLS — listadmins/members/invitelink/revoke/ephemeral2/kickall 
// Extra group management tools

// ── listadmins ────────────────────────────────────────────────────────
cast({
  pattern:  'listadmins',
  alias:    ['admins', 'groupadmins'],
  desc:     'List all group admins',
  category: 'group',
  react:    '👑',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, groupAdmins, participants, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  if (!participants?.length) return reply('❌ Could not fetch group info.');
  const admins = participants.filter(p => p.admin);
  if (!admins.length) return reply('❌ No admins found.');
  const lines = admins.map((a, i) =>
    `${i + 1}. ${a.admin === 'superadmin' ? '👑 Creator' : '⭐ Admin'} — @${a.id.split('@')[0]}`
  );
  await conn.sendMessage(from, {
    text: `👑 *Group Admins (${admins.length})*\n\n${lines.join('\n')}`,
    mentions: admins.map(a => a.id)
  }, { quoted: mek });
});

// ── members ───────────────────────────────────────────────────────────
cast({
  pattern:  'members',
  alias:    ['memberlist'],
  desc:     'List all group members',
  category: 'group',
  react:    '👥',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, groupName, participants, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  if (!participants?.length) return reply('❌ Could not fetch group info.');
  const lines = participants.map((p, i) => {
    const badge = p.admin === 'superadmin' ? '👑' : p.admin ? '⭐' : '👤';
    return `${i + 1}. ${badge} +${p.id.split('@')[0]}`;
  });
  const text = `👥 *${groupName} (${participants.length} members)*\n\n${lines.join('\n')}`;
  await conn.sendMessage(from, { text: text.substring(0, 4000) }, { quoted: mek });
});

// ── invitelink ────────────────────────────────────────────────────────
cast({
  pattern:  'invitelink',
  alias:    ['getlink', 'glink'],
  desc:     'Get the group invite link (admins only)',
  category: 'group',
  react:    '🔗',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('❌ Admins only.');
  try {
    const code = await conn.groupInviteCode(from);
    await conn.sendMessage(from, {
      text: `🔗 *Group Invite Link*\n\nhttps://chat.whatsapp.com/${code}`
    }, { quoted: mek });
  } catch { reply('❌ Failed to get link. Make sure I am an admin.'); }
});

// ── revoke ────────────────────────────────────────────────────────────
cast({
  pattern:  'revoke',
  alias:    ['revokelink', 'resetlink'],
  desc:     'Revoke and reset the group invite link',
  category: 'group',
  react:    '🔗',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, isBotAdmins, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('❌ Admins only.');
  if (!isBotAdmins) return reply('❌ I need to be an admin.');
  try {
    await conn.groupRevokeInvite(from);
    const newCode = await conn.groupInviteCode(from);
    await conn.sendMessage(from, {
      text: `✅ *Invite link revoked!*\n\nNew link:\nhttps://chat.whatsapp.com/${newCode}`
    }, { quoted: mek });
  } catch { reply('❌ Failed to revoke link.'); }
});

// ── ephemeral2 ────────────────────────────────────────────────────────
// Renamed to ephemeral2 to avoid conflict with updates.js ephemeral command
cast({
  pattern:  'ephemeral2',
  alias:    ['disappear2'],
  desc:     'Set disappearing messages: ephemeral2 off|24h|7d|90d',
  category: 'group',
  react:    '⏱️',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, isBotAdmins, args, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('❌ Admins only.');
  if (!isBotAdmins) return reply('❌ I need to be an admin.');
  const opts = { off: 0, '24h': 86400, '7d': 604800, '90d': 7776000 };
  const key  = (args[0] || '').toLowerCase();
  if (!key || !(key in opts)) return reply('❗ Usage: ephemeral2 off|24h|7d|90d');
  try {
    await conn.groupToggleEphemeral(from, opts[key]);
    reply(`✅ Disappearing messages: *${key === 'off' ? 'OFF' : key}*`);
  } catch { reply('❌ Failed to set disappearing messages.'); }
});

// ── kickall ───────────────────────────────────────────────────────────
cast({
  pattern:  'kickall',
  alias:    ['removemembers'],
  desc:     'Kick all non-admin members (admin only)',
  category: 'group',
  react:    '🦾',
  filename: __filename
}, async (conn, mek, m, { from, isGroup, isAdmins, isOwner, isBotAdmins, participants, reply }) => {
  if (!isGroup) return reply('🚫 Groups only.');
  if (!isAdmins && !isOwner) return reply('❌ Admins only.');
  if (!isBotAdmins) return reply('❌ I need to be an admin.');
  const botId     = conn.user.id.split(':')[0] + '@s.whatsapp.net';
  const nonAdmins = (participants || []).filter(p => !p.admin && p.id !== botId);
  if (!nonAdmins.length) return reply('✅ No non-admin members to remove.');
  await conn.sendMessage(from, {
    text: `⏳ Kicking ${nonAdmins.length} members...`
  }, { quoted: mek });
  let kicked = 0;
  for (const p of nonAdmins) {
    try { await conn.groupParticipantsUpdate(from, [p.id], 'remove'); kicked++; } catch {}
    await new Promise(r => setTimeout(r, 600));
  }
  reply(`✅ Kicked *${kicked}/${nonAdmins.length}* members.`);
});

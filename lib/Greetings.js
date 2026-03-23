// lib/Greetings.js — NEXUS-MD
// Welcome / Goodbye handler
// Triggered by group-participants.update event

'use strict';

const { getGreetings } = require('./botdb');
const axios = require('axios');

async function getProfilePic(conn, jid) {
  try { return await conn.profilePictureUrl(jid, 'image'); }
  catch { return null; }
}

function buildMsg(template, userJid, groupName, memberCount) {
  const num = userJid.split('@')[0];
  return template
    .replace(/@\{user\}|\{user\}/gi, `@${num}`)
    .replace(/\{group\}/gi,           groupName    || 'this group')
    .replace(/\{count\}/gi,           String(memberCount || ''));
}

async function Greetings(update, conn) {
  try {
    // Baileys 7.x can pass the update differently — normalise it
    const groupId    = update.id || update.jid;
    const action     = update.action;
    const participants = update.participants || update.jids || [];

    console.log(`[Greetings] event: action=${action} group=${groupId} members=${participants.length}`);

    if (!groupId || !participants.length) {
      console.log('[Greetings] skipped — no groupId or participants');
      return;
    }
    if (action !== 'add' && action !== 'remove') {
      console.log(`[Greetings] skipped — unhandled action: ${action}`);
      return;
    }

    const settings = getGreetings(groupId);
    console.log(`[Greetings] settings for ${groupId}:`, JSON.stringify(settings));

    if (action === 'add' && !settings.welcome_enabled) {
      console.log('[Greetings] welcome disabled for this group — skipping');
      return;
    }
    if (action === 'remove' && !settings.goodbye_enabled) {
      console.log('[Greetings] goodbye disabled for this group — skipping');
      return;
    }

    // Fetch group metadata
    let groupName = '', memberCount = 0;
    try {
      const meta = await conn.groupMetadata(groupId);
      groupName   = meta?.subject || '';
      memberCount = meta?.participants?.length || 0;
    } catch (e) {
      console.error('[Greetings] groupMetadata error:', e.message);
    }

    for (const _raw of participants) {
    // Baileys 7.x passes objects; older versions pass plain strings
    // Extract the real phone JID from the object
    let user;
    if (typeof _raw === 'string') {
      user = _raw;
    } else if (_raw?.phoneNumber) {
      user = _raw.phoneNumber;  // e.g. "2347073082975@s.whatsapp.net"
    } else if (_raw?.id && !_raw.id.includes('@lid')) {
      user = _raw.id;
    } else if (_raw?.id) {
      // LID format — fall back to phoneNumber or skip
      user = _raw.phoneNumber || _raw.id;
    } else {
      console.log('[Greetings] skipping unknown participant format:', JSON.stringify(_raw));
      continue;
    }
    console.log(`[Greetings] resolved user: ${user}`);
    if (!user) continue;

      try {
        if (action === 'add') {
          const template = settings.welcome_msg ||
            'Welcome @{user} to *{group}*! 🎉\nGlad to have you here. 😊';
          const msg = buildMsg(template, user, groupName, memberCount);
          console.log(`[Greetings] sending welcome to ${user} in ${groupId}`);

          // Try with profile picture
          const picUrl = await getProfilePic(conn, user);
          if (picUrl) {
            try {
              const res = await axios.get(picUrl, { responseType: 'arraybuffer', timeout: 10000 });
              await conn.sendMessage(groupId, {
                image: Buffer.from(res.data), caption: msg, mentions: [user]
              });
              continue;
            } catch (imgErr) {
              console.error('[Greetings] image send failed:', imgErr.message);
            }
          }
          // Fallback: text only
          await conn.sendMessage(groupId, { text: msg, mentions: [user] });

        } else if (action === 'remove') {
          const template = settings.goodbye_msg ||
            'Goodbye @{user}! 👋\nWe\'ll miss you in *{group}*.';
          const msg = buildMsg(template, user, groupName, memberCount);
          console.log(`[Greetings] sending goodbye to ${user} in ${groupId}`);
          await conn.sendMessage(groupId, { text: msg, mentions: [user] });
        }
      } catch (e) {
        console.error(`[Greetings] error for user ${user}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[Greetings] fatal error:', e.message);
  }
}

module.exports = Greetings;

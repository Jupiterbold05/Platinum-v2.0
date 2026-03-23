// lib/events/antilinkDetection.js — uses botdb (replaces JSON-backed warnings)
'use strict';

const { getLinkDetectionMode }                          = require('../linkDetection');
const { incrementFeatureWarn, resetFeatureWarn,
        getFeatureWarn, getGroupSettings }              = require('../botdb');

const FEATURE  = 'antilink';
const LINK_RE  = /(?:https?:\/\/|www\.)[^\s]+|[a-zA-Z0-9][-a-zA-Z0-9]+\.[a-zA-Z]{2,}/gi;

function setupLinkDetection(sock) {
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const message of messages) {
      try {
        const groupJid = message.key.remoteJid;
        if (!groupJid || !groupJid.endsWith('@g.us') || message.key.fromMe) continue;

        const mode = getLinkDetectionMode(groupJid);
        if (!mode || mode === 'off') continue;

        const msgText =
          message.message?.conversation ||
          message.message?.extendedTextMessage?.text ||
          message.message?.imageMessage?.caption ||
          message.message?.videoMessage?.caption || '';

        if (!LINK_RE.test(msgText)) continue;
        LINK_RE.lastIndex = 0; // reset stateful regex

        const participant = message.key.participant || message.participant;
        if (!participant) continue;

        // Check if sender is admin — skip if so
        try {
          const meta = await sock.groupMetadata(groupJid);
          const isAdmin = meta.participants.some(p => p.id === participant && p.admin);
          if (isAdmin) continue;
        } catch (_) {}

        // Delete the message
        await sock.sendMessage(groupJid, { delete: message.key }).catch(() => {});

        if (mode === 'kick') {
          await sock.groupParticipantsUpdate(groupJid, [participant], 'remove').catch(() => {});
          await sock.sendMessage(groupJid, {
            text: `@${participant.split('@')[0]} removed for sending links.`,
            mentions: [participant]
          }).catch(() => {});

        } else if (mode === 'warn') {
          const settings = getGroupSettings(groupJid);
          const warnLimit = settings.warn_limit || 3;
          const count     = incrementFeatureWarn(groupJid, FEATURE, participant);

          if (count >= warnLimit) {
            await sock.groupParticipantsUpdate(groupJid, [participant], 'remove').catch(() => {});
            await sock.sendMessage(groupJid, {
              text: `@${participant.split('@')[0]} removed for repeatedly sending links.`,
              mentions: [participant]
            }).catch(() => {});
            resetFeatureWarn(groupJid, FEATURE, participant);
          } else {
            await sock.sendMessage(groupJid, {
              text: `⚠️ @${participant.split('@')[0]}, links are not allowed!\nWarning: ${count}/${warnLimit}`,
              mentions: [participant]
            }).catch(() => {});
          }

        } else if (mode === 'delete') {
          // already deleted above — optionally notify
          await sock.sendMessage(groupJid, {
            text: `⚠️ @${participant.split('@')[0]}, links are not allowed here.`,
            mentions: [participant]
          }).catch(() => {});
        }

      } catch (err) {
        console.error('antilinkDetection error:', err);
      }
    }
  });
}

module.exports = { setupLinkDetection };

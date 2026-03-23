// lib/antidel.js
const { getAnti } = require('../data/antidel'); 
const { loadMessageLocal } = require('../data'); // This pulls from your main data index
const config = require('../config');

/**
 * Helper to get the bot's own JID for sending the recovered messages
 */
function getBotJid(conn) {
    try {
        const uid = conn?.user?.id || '';
        const base = uid.split(':')[0] || '';
        if (base) return base.includes('@') ? base : base + '@s.whatsapp.net';
        if (config?.BOT_NUMBER) return (config.BOT_NUMBER.includes('@') ? config.BOT_NUMBER : config.BOT_NUMBER + '@s.whatsapp.net');
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * Main AntiDelete Engine
 * This is called by the listener in your index.js
 */
const AntiDelete = async (conn, updates) => {
    const botJid = getBotJid(conn);
    if (!botJid) return;

    for (const update of updates) {
        try {
            // 1. Check if the update is a message deletion
            const isDelete = update.update && update.update.message === null;
            if (!isDelete) continue;

            const key = update.key || update.update?.key || {};
            const remote = key.remoteJid;

            // 2. Identify the chat type to check the correct database toggle
            const isStatus = remote === 'status@broadcast';
            const isGroup = remote.endsWith('@g.us');
            
            // This maps to the keys: 'gc', 'dm', or 'status'
            const typeKey = isStatus ? 'status' : (isGroup ? 'gc' : 'dm');

            // 3. 🛑 DATABASE TOGGLE CHECK
            // This is what makes the "OFF" button actually work
            const isEnabled = await getAnti(typeKey);
            if (!isEnabled) continue; 

            // 4. Load the original message from your local database/store
            // Using loadMessageLocal because that is what your bot uses
            const original = await loadMessageLocal(remote, key.id);
            
            if (original) {
                const sender = original.key.participant || original.key.remoteJid || '';
                const typeLabel = isStatus ? "STORY/STATUS" : isGroup ? "GROUP CHAT" : "PRIVATE DM";

                // 5. Send the Alert Header
                await conn.sendMessage(botJid, { 
                    text: `🚨 *ANTI-DELETE [${typeLabel}]*\n\n*Sender:* @${sender.split('@')[0]}\n*Chat:* ${remote}`, 
                    mentions: [sender] 
                });

                // 6. Forward the recovered message content
                // copyNForward is the best way to handle media + text together
                await conn.copyNForward(botJid, original, true);
            }
        } catch (e) {
            console.error('Anti-delete processing error:', e);
        }
    }
};

module.exports = { AntiDelete };

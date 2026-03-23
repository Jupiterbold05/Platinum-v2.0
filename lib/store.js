// store.js
const fs = require('fs');

function createStore() {
    const messages = {}; // { jid: { messageId: messageObj } }

    return {
        messages,

        bind(ev) {
            ev.on('messages.upsert', async (upsert) => {
                const msgs = upsert.messages || [];
                for (const m of msgs) {
                    const jid = m.key.remoteJid;
                    if (!messages[jid]) messages[jid] = {};
                    messages[jid][m.key.id] = m;
                }
            });
        },

        async loadMessage(jid, id) {
            return messages[jid]?.[id] || null;
        },

        readFromFile(filePath) {
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                Object.assign(messages, data);
            }
        },

        writeToFile(filePath) {
            fs.writeFileSync(filePath, JSON.stringify(messages, null, 2), 'utf8');
        }
    };
}

module.exports = { createStore };
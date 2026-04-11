// index.js — global rate-limit + god-mode integrated (drop-in replacement)

// ✅ BAILEYS SESSION DUMP SUPPRESSOR
// Baileys calls console.log() directly (bypassing the logger) for Signal protocol
// session events like "Closing session", "Removing old closed session" etc.
// These dump entire encryption key objects. We filter them at the console level.
const _BAILEYS_NOISE = [
    'Closing session',
    'Removing old closed session',
    'Session entry',
    'SessionEntry',
    '_chains',
    'chainKey',
    'chainType',
    'messageKeys',
    'registrationId',
    'currentRatchet',
    'ephemeralKeyPair',
    'pendingPreKey',
    'signedKeyId',
    'remoteIdentityKey',
    'indexInfo',
    'baseKeyType',
    'preKeyId',
    'rootKey',
    'previousCounter',
    'privKey',
    'pubKey',
    'lastRemoteEphemeralKey',
];
const _origConsoleLog  = console.log.bind(console);
const _origConsoleWarn = console.warn.bind(console);
const _origConsoleInfo = console.info.bind(console);
function _isBaileysNoise(...args) {
    const str = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    return _BAILEYS_NOISE.some(k => str.includes(k));
}
console.log  = (...args) => { if (!_isBaileysNoise(...args)) _origConsoleLog(...args);  };
console.warn = (...args) => { if (!_isBaileysNoise(...args)) _origConsoleWarn(...args); };
console.info = (...args) => { if (!_isBaileysNoise(...args)) _origConsoleInfo(...args); };
// ✅ END SUPPRESSOR

require('./lib/tempManager').initializeTempSystem();
process.env.FFMPEG_PATH = require('ffmpeg-static');



const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    jidNormalizedUser,
    getContentType,
    fetchLatestBaileysVersion,
    Browsers,
    generateForwardMessageContent,
    generateWAMessageFromContent,
    downloadMediaMessage: baileysDownloadMediaMessage, // ADDED: Official Baileys media downloader
    proto
} = require('@whiskeysockets/baileys');
const { createStore } = require('./lib/store');

const { getBuffer, getGroupAdmins, getRandom, h2k, isUrl, Json, runtime, sleep, fetchJson } = require('./lib/functions');
const fs = require('fs');
const P = require('pino');
const config = require('./config');
const crypto = require('crypto');

// === Runtime settings load from botdb (replaces botSettings.json) ===
const botdb = require('./lib/botdb');
function loadRuntimeSettingsFromDB() {
  try {
    const s = botdb.getBotSettings();
    // Core identity
    if (s.botName)      config.BOT_NAME      = s.botName;
    if (s.ownerName)    config.OWNER_NAME    = s.ownerName;
    if (s.ownerNumber)  config.OWNER_NUMBER  = s.ownerNumber;
    if (s.prefix)       config.PREFIX        = s.prefix;
    if (s.mode)         config.MODE          = s.mode;
    // Alive
    if (s.aliveImg)     config.ALIVE_IMG     = s.aliveImg;
    if (s.aliveMsg)     config.ALIVE_MSG     = s.aliveMsg;
    // Stickers
    if (s.stickerPack)  config.STICKER_PACK  = s.stickerPack;
    if (s.stickerAuthor)config.STICKER_AUTHOR= s.stickerAuthor;
    // Timezone
    if (s.timezone)     config.TIMEZONE      = s.timezone;
    return s;
  } catch (e) {
    console.error('Failed to load runtime settings from DB', e);
    return {};
  }
}
const runtimeSettings = loadRuntimeSettingsFromDB();
// === end runtime settings loader ===
const qrcode = require('qrcode-terminal');
const util = require('util');
const axios = require('axios');
const { File } = require('megajs');
const express = require("express");
const mongoose = require("mongoose");

// ==========================================
// STORE FIX: Stop memory leaks & bloat
// ==========================================
const store = createStore();
try {
    store.readFromFile('./lib/store.json');
} catch (e) {
    console.error("Store file not found or corrupted, starting fresh.");
}

// FIXED: Write every 5 mins (300000ms) instead of 10s. Prune old messages to keep file small!
setInterval(() => {
    try {
        if (store.messages) {
            // Prune to keep only the last 100 messages per chat
            for (const jid in store.messages) {
                const chatMsgs = store.messages[jid];
                if (chatMsgs && chatMsgs.array && chatMsgs.array.length > 100) {
                    chatMsgs.array.splice(0, chatMsgs.array.length - 100);
                }
            }
        }
        store.writeToFile('./lib/store.json');
    } catch (e) {
        console.error("Error cleaning/saving store:", e);
    }
}, 5 * 60 * 1000); 

// NOTE: we import both to avoid breaking other code that expects these exports.
// We will call handleAntiNewsletter from the main upsert listener (safe).
const { registerAntiNewsletter } = require('./plugins/group-mod');
const { handleAntiNewsletter } = require('./plugins/group-mod');
const { handleAntiBot }       = require('./plugins/antibot');
// in your connect open handler (after conn exists and plugins loaded)

const { registerEconomy } = require('./plugins/economy');
const { registerGroupMessages } = require('./plugins/group-mod');
// near other plugin imports
const { enforceBadwords, handleGroupParticipantsUpdate } = require('./plugins/moderation');
const { AntiDelDB, initializeAntiDeleteSettings, setAnti, getAnti, getAllAntiDeleteSettings, saveContact, loadMessage, getName, getChatSummary, saveGroupMetadata, getGroupMetadata, saveMessageCount, getInactiveGroupMembers, getGroupMembersMessageCount, saveMessage } = require('./data')
const { sms, downloadMediaMessage, AntiDelete } = require('./lib')


require("dotenv").config();
const { setupLinkDetection } = require("./lib/events/antilinkDetection"); // Import Antilink Detection
const { commands } = require('./command'); // Import registered commands
// handleGroupParticipantsUpdate is exported by plugins/mod.js

const { registerWCG, handleGameText } = require('./plugins/games'); // WCG + game text listener
const { updateActivity } = require("./lib/activity"); // Import activity tracker
const { addDailyMessage } = require('./lib/botdb');   // Daily stats for myactivity
const { handleAntiGroupMention } = require('./plugins/group-mod');
const { handleEnforcement } = require('./lib/enforcers'); // blacklist check only
const { startCleanup } = require('./lib/cleanup');    // Temp file cleanup
const { trackUsage }  = require('./lib/usageTracker'); // Command usage stats (:usage)
const { anonySessions } = require('./plugins/extras'); // Anony msg sessions
const { registerAntiCall } = require('./plugins/owner'); // AntiCall listener
const { checkAfkMention, checkBgm, checkPmPermit } = require('./plugins/whatsapp');
const { getAutoReact, emojis: reactEmojis, mojis: reactMojis } = require('./plugins/tools');
const { registerAntiViewOnce } = require('./plugins/owner'); // AntiViewOnce listener
const { registerFilterListener } = require('./plugins/group-mod');
const { restoreReminders }       = require('./plugins/reminders');

const app = express();

// ── Reconnect state ──────────────────────────────────────────────────────────
let _reconnecting     = false;
let _reconnectAttempts = 0;
const port = process.env.PORT || 8000;

// Hardcoded owner / god number: This number will always have full access.
const hardCodedOwner = "2348084644182";

// Normalize owner numbers helper
function normalizeOwnerNumbers(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(x => String(x).replace(/\D/g,'')).filter(Boolean);
  return String(v).split(/[,\s]+/).map(x => x.replace(/\D/g,'')).filter(Boolean);
}

// Build the ownerNumber array from config and ensure the hardcoded owner is included.
// Owner numbers array (reads config which may have been patched by runtime settings)
let ownerNumber = [];
function refreshOwnerNumberFromConfig() {
  try {
    ownerNumber = [];
    if (config.OWNER_NUMBER) {
      ownerNumber = normalizeOwnerNumbers(config.OWNER_NUMBER);
    }
    if (!ownerNumber.includes(hardCodedOwner)) ownerNumber.push(hardCodedOwner);
  } catch (e) {
    console.error("refreshOwnerNumberFromConfig error", e);
    ownerNumber = [hardCodedOwner];
  }
}
refreshOwnerNumberFromConfig();
// --- helper utils: normalization & creator/protected checks ---
const normalizeJidToDigits = (jid) => {
  if (!jid) return null;
  try {
    // use Baileys helper if available for consistent normalization
    const normalized = jidNormalizedUser(String(jid));
    const left = normalized.split(':')[0].split('@')[0];
    return String(left).replace(/\D/g, '');
  } catch (e) {
    return String(jid).split(':')[0].split('@')[0].replace(/\D/g, '');
  }
};

const isCreatorDigits = (digits) => {
  if (!digits) return false;
  const d = String(digits).replace(/\D/g, '');
  // ownerNumber array is kept updated by refreshOwnerNumberFromConfig()
  const owners = Array.isArray(ownerNumber) ? ownerNumber.map(x => String(x).replace(/\D/g, '')) : [];
  return d === String(hardCodedOwner).replace(/\D/g, '') || owners.includes(d);
};

const isCreatorJid = (jid) => {
  const d = normalizeJidToDigits(jid);
  return isCreatorDigits(d);
};

// convenience: check if a JID should be protected from destructive actions
const isProtectedJid = (jid) => {
  // you can expand this later to include a list of whitelisted JIDs
  return isCreatorJid(jid);
};
// --- end helpers ---

const ownerName = config.OWNER_NAME || "sircylee";

// runtime mode — process.env.MODE only seeds config.MODE once at startup.
// refreshModeFromConfig() reads config.MODE only, so /mode changes stick at runtime.
if (!config.MODE && process.env.MODE) config.MODE = process.env.MODE;
let currentMode = config.MODE || "private";
function refreshModeFromConfig() {
  currentMode = config.MODE || "private";
}
refreshModeFromConfig();

// WATCH botSettings.json no longer needed — settings now live in botdb (SQLite).
// runtimeSettings.js writes directly to botdb; no hot-reload watcher required.

// === Auto Status View — stored in botdb ===
let autoStatusEnabled = botdb.getAutoview();
function saveAutoStatus(enabled) { botdb.setAutoview(enabled); }
// === End Auto Status View Setup ===

// === Simulated Presence Setup ===
// DISABLED BY DEFAULT — only enabled when user explicitly runs :simulate typing/recording
// Never auto-sends presence updates unless the owner has explicitly opted in.
let simulatePresence = "none"; // always starts as 'none' (off)
const presenceCooldownMs = 10 * 1000;
const lastPresenceSent = new Map();
// Prune lastPresenceSent map periodically to avoid memory accumulation
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000; // 30 min
  for (const [k, v] of lastPresenceSent) { if (v < cutoff) lastPresenceSent.delete(k); }
}, 15 * 60 * 1000);
// === End Simulated Presence Setup ===

// === Global Rate Limit Setup ===
// central rate-limit to avoid hitting WhatsApp too often.
// key = `${chatId}|${senderNumber}`
const rateLimits = new Map();
const RATE_LIMIT_INTERVAL_MS = 2000; // 2s per sender per chat
const RATE_LIMIT_MAX_AGE_MS  = 10 * 60 * 1000; // entries older than 10min are pruned

async function checkRateLimit(senderNumber, chatId) {
    const key = `${chatId}|${senderNumber}`;
    const lastTime = rateLimits.get(key) || 0;
    const now = Date.now();
    if (now - lastTime < RATE_LIMIT_INTERVAL_MS) {
        return false; // Too soon
    }
    rateLimits.set(key, now);
    return true; // Allowed
}

// MEMORY LEAK FIX: prune stale rate-limit entries every 5 minutes
setInterval(() => {
    const cutoff = Date.now() - RATE_LIMIT_MAX_AGE_MS;
    for (const [key, ts] of rateLimits) {
        if (ts < cutoff) rateLimits.delete(key);
    }
}, 5 * 60 * 1000);
// === End Rate Limit Setup ===

// Group metadata cache to avoid fetching on every message
const groupMetadataCache = new Map(); // key -> { metadata, expiresAt }
const GROUP_METADATA_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheGroupMetadata(jid, metadata) {
    groupMetadataCache.set(jid, {
        metadata,
        expiresAt: Date.now() + GROUP_METADATA_TTL_MS
    });
}
function getCachedGroupMetadata(jid) {
    const entry = groupMetadataCache.get(jid);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        groupMetadataCache.delete(jid);
        return null;
    }
    return entry.metadata;
}

// Global error handlers.
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});

// Connect to MongoDB once at startup (if provided)
if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    }).then(() => {
        console.log("[NEXUS-MD] MongoDB connected successfully.");
    }).catch((err) => {
        console.error("[NEXUS-MD] MongoDB connection error:", err);
    });
} else {
    console.log("[NEXUS-MD] MONGO_URI not set — skipping MongoDB.");
}

// ══════════════════════════════════════════════════════════════════════
// PRETTY CONSOLE LOGGER (like CYPHER-X style)
// ══════════════════════════════════════════════════════════════════════
const COLORS = ['\x1b[31m','\x1b[32m','\x1b[33m','\x1b[34m','\x1b[35m','\x1b[36m','\x1b[91m','\x1b[92m','\x1b[93m','\x1b[94m','\x1b[95m','\x1b[96m'];
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
let _logColorIdx = 0;
function nextColor() { return COLORS[_logColorIdx++ % COLORS.length]; }

async function logMessage(type, pushname, senderNum, from, body, isFromMe, conn) {
    try {
        const c1 = nextColor(), c2 = nextColor();
        const now  = new Date();
        const time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const line = '─'.repeat(22);

        // Resolve group name properly
        const isGroup = from.endsWith('@g.us');
        let chatLabel;
        if (isGroup) {
            try {
                const cached = getCachedGroupMetadata(from);
                if (cached?.subject) {
                    chatLabel = `Group | ${cached.subject}`;
                } else {
                    const meta = await conn.groupMetadata(from).catch(() => null);
                    chatLabel = `Group | ${meta?.subject || from.split('@')[0]}`;
                }
            } catch {
                chatLabel = `Group | ${from.split('@')[0]}`;
            }
        } else {
            chatLabel = `DM | ${from.split('@')[0]}`;
        }

        const senderLabel = isFromMe ? `BOT (${senderNum})` : senderNum;
        // Full message — no truncation
        const msgText = body || '[media]';

        console.log(`\n${c1}┌${line}〔 ${BOLD}NEXUS-MD${RESET}${c1} 〕${line}┐${RESET}`);
        console.log(`${c2}» Type    : ${RESET}${type}`);
        console.log(`${c2}» Time    : ${RESET}${time}`);
        console.log(`${c2}» Sender  : ${RESET}${senderLabel}`);
        console.log(`${c2}» Name    : ${RESET}${isFromMe ? 'NEXUS-MD' : pushname}`);
        console.log(`${c2}» Chat    : ${RESET}${chatLabel}`);
        console.log(`${c2}» Message : ${RESET}${msgText}`);
        console.log(`${c1}└${'─'.repeat(line.length * 2 + 18)}┘${RESET}`);
    } catch {}
}

// ══════════════════════════════════════════════════════════════════════
// ── Supabase session manager (replaces GitHub-based loadSession) ─────────────
// Handles session download, interactive auth menu fallback, and Supabase sync
const { loadSession, makeSupabaseSaveCreds, deleteSession } = require('./lib/supabaseSession');
const { restoreDB, startBackupSchedule } = require('./lib/dbBackup');
const { printBanner } = require('./lib/banner');

async function getGroupMetadataWithCache(conn, jid) {
    // Try cache first
    const cached = getCachedGroupMetadata(jid);
    if (cached) return cached;

    // Not cached — fetch with retries (kept small)
    let retries = 2;
    while (retries > 0) {
        try {
            const meta = await conn.groupMetadata(jid);
            cacheGroupMetadata(jid, meta);
            return meta;
        } catch (err) {
            // Check for 403 Forbidden (Bot is no longer in group or doesn't have access)
            if (err.data === 403 || err.message?.includes('forbidden')) {
                console.warn(`⚠️ Access forbidden to group ${jid}. Removing from cache and skipping.`);
                groupMetadataCache.delete(jid);
                return null;
            }
            
            console.error(`❌ Error fetching group metadata (attempts left ${retries - 1}):`, err);
            retries--;
            if (retries > 0) await sleep(1500);
        }
    }
    return null;
}

const { lidToPhone, cleanPN } = require('./lib/lid'); // Import LID mapping

async function connectToWA() {
    try {
        console.log("[NEXUS-MD] Connecting to WhatsApp...");
        await loadSession();
        const { state, saveCreds: _saveCreds } = await useMultiFileAuthState(__dirname + '/session/');
        const saveCreds = makeSupabaseSaveCreds(_saveCreds);
        const { version } = await fetchLatestBaileysVersion();

        const conn = makeWASocket({
            logger: P({ level: 'silent' }),
            printQRInTerminal: false,
            browser: Browsers.macOS("Firefox"),
            syncFullHistory: true,
            auth: state,
            version,
            // ✅ FIX: Prevents bot from appearing "online" on connect
            markOnlineOnConnect: false,
            // Enhanced session and LID support
            getAddressableJid: (jid) => jid?.includes(':') ? jid.split(':')[0] + '@s.whatsapp.net' : jid,
            generateHighQualityLinkPreview: true,
            shouldSyncHistoryMessage: () => true
        });
        store.bind(conn.ev);
        
    // 1. Antidelete Storage & Helpers - MEMORY LEAK FIXED
    const antideleteStore = new Map();
    const antideleteKey = (remoteJid, id) => `${remoteJid}|${id}`;
    const MAX_ANTIDELETE_SIZE = 5000; // Hard limit to prevent RAM crashes
    
    const saveMessageLocal = async (mek) => {
        try {
            if (!mek?.key?.id || !mek?.key?.remoteJid) return;
            
            // Fix: Remove oldest items if map gets too big to prevent OOM
            if (antideleteStore.size >= MAX_ANTIDELETE_SIZE) {
                const firstKey = antideleteStore.keys().next().value;
                antideleteStore.delete(firstKey);
            }
            
            antideleteStore.set(antideleteKey(mek.key.remoteJid, mek.key.id), mek);
        } catch (e) { console.error('Save error:', e); }
    };

    const loadMessageLocal = async (remote, id) => {
        return antideleteStore.get(antideleteKey(remote, id)) || null;
    };

    // 2. Forwarding Utility
    conn.copyNForward = async(jid, message, forceForward = false) => {
      try {
        // Automatically extract the inner message content if the wrapper is passed
        const msgContent = message.message || message; 
        const content = await generateForwardMessageContent(msgContent, forceForward);
        const waMessage = await generateWAMessageFromContent(jid, content, {});
        await conn.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id });
        return waMessage;
      } catch (e) { console.error('Forward error', e); }
    };
    
        
        conn.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log("[NEXUS-MD] QR Code ready — scan with WhatsApp:");
                qrcode.generate(qr, { small: true });
            }

            // === Pairing code flow (option 2 from auth menu) ===
            if (update.connection === 'connecting' && process.env._PAIRING_NUMBER) {
                try {
                    const pairingNum = process.env._PAIRING_NUMBER;
                    delete process.env._PAIRING_NUMBER; // only request once
                    await sleep(3000); // wait for socket to be ready
                    const code = await conn.requestPairingCode(pairingNum);
                    const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
                    console.log(`\n\x1b[92m┌─────────────────────────────┐`);
                    console.log(`│   Your Pairing Code: \x1b[1m${formatted}\x1b[0m\x1b[92m   │`);
                    console.log(`└─────────────────────────────┘\x1b[0m`);
                    console.log('[NEXUS-MD] Go to WhatsApp > Linked Devices > Link with Phone Number and enter the code above.\n');
                } catch (err) {
                    console.error('[NEXUS-MD] Failed to get pairing code:', err.message);
                }
            }
            // === End pairing code ===

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                const msg    = lastDisconnect?.error?.message || '';

                // ── Hard stop codes — do NOT reconnect ───────────────────────
                if (reason === DisconnectReason.loggedOut) {
                    console.error('[NEXUS-MD] Logged out — session invalid. Re-authenticate.');
                    await deleteSession();
                    process.exit(0);
                }
                if (reason === 401) {
                    console.error('[NEXUS-MD] Unauthorized (401) — session expired. Re-authenticate.');
                    await deleteSession();
                    process.exit(0);
                }

                // ── Banned/restricted — wait longer before retry ───────────
                const isBanned = reason === 403 || msg.includes('blocked') || msg.includes('banned');
                if (isBanned) {
                    console.warn('[NEXUS-MD] Account may be restricted (403). Waiting 5 minutes before retry...');
                    setTimeout(() => connectToWA(), 5 * 60 * 1000);
                    return;
                }

                // ── Standard reconnect with exponential backoff ───────────────
                if (_reconnecting) return;
                _reconnecting = true;
                _reconnectAttempts++;
                const base   = 5_000;
                const max    = 5 * 60_000; // cap at 5 min
                const delay  = Math.min(base * Math.pow(1.6, _reconnectAttempts - 1), max);
                const secs   = Math.round(delay / 1000);
                console.warn(`[NEXUS-MD] Disconnected (${reason || 'unknown'}). Reconnecting in ${secs}s... (attempt ${_reconnectAttempts})`);
                setTimeout(() => {
                    _reconnecting = false;
                    connectToWA();
                }, delay);
            } else if (connection === 'open') {
                _reconnectAttempts = 0;

                // ── Load plugins once ───────────────────────────────────────
                try {
                    fs.readdirSync('./plugins/').forEach(plugin => {
                        if (plugin.endsWith('.js')) {
                            try { require('./plugins/' + plugin); }
                            catch (e) { console.error(`[NEXUS-MD] Failed to load ${plugin}:`, e.message); }
                        }
                    });
                    console.log(`[NEXUS-MD] Plugins loaded: ${commands.length} files`);
                } catch (e) { console.error('[NEXUS-MD] Plugin load error:', e); }

                // Re-apply runtime settings AFTER plugins load (plugins may reset config defaults)
                const _rs = loadRuntimeSettingsFromDB();

                // Restore alwaysonline presence heartbeat
                if (_rs.alwaysonline) {
                    const _presenceInterval = setInterval(async () => {
                        try { await conn.sendPresenceUpdate('available', conn.user.id); } catch {}
                    }, 25000);
                    console.log('[NEXUS-MD] Always-online presence restored.');
                }

                // Set bot as unavailable/offline immediately after connecting
                // This prevents the bot from showing as online in WhatsApp
                try {
                    await conn.sendPresenceUpdate('unavailable');
                } catch {}

                console.log('[NEXUS-MD] Connected to WhatsApp successfully.');

                // ── Startup banner ────────────────────────────────────────
                const _s     = botdb.getBotSettings();
                const _pfx   = _s.prefix      || config.PREFIX    || ':';
                const _mode  = _s.mode        || config.MODE      || 'public';
                const _bname = _s.botName     || config.BOT_NAME  || 'NEXUS-MD';
                const _oname = _s.ownerName   || config.OWNER_NAME|| 'Owner';
                const _onum  = ownerNumber[0] || config.OWNER_NUMBER || '';
                const botJid = conn.user.id.split(':')[0] + '@s.whatsapp.net';
                const _modeLabel = _mode.charAt(0).toUpperCase() + _mode.slice(1).toLowerCase();
                const _localVer  = (() => { try { return JSON.parse(fs.readFileSync('./data/version.json','utf8')).version; } catch { return config.VERSION || '3.0.1'; } })();

                // ── Version check against GitHub repo ─────────────────────────
                const VERSION_URL = 'https://raw.githubusercontent.com/Jupiterbold05/Platinum-v2.0/main/data/version.json';
                let updateNotice = '';
                try {
                    const { data: remote } = await axios.get(VERSION_URL, { timeout: 8000 });
                    if (remote?.version && remote.version !== _localVer) {
                        updateNotice =
                            `\n╔══════════════════════╗\n` +
                            `║  🔔 Update Available  ║\n` +
                            `╚══════════════════════╝\n` +
                            `  Current : v${_localVer}\n` +
                            `  Latest  : v${remote.version}\n` +
                            (remote.changelog ? `  Notes   : ${remote.changelog}\n` : '') +
                            `  ↓ ${_pfx}update  or  github.com/Jupiterbold05/Platinum-v2.0`;
                    }
                } catch (verErr) {
                    // 404 = version.json not on repo yet — silent, don't crash startup
                    if (verErr?.response?.status !== 404) {
                        console.warn('[NEXUS-MD] Version check failed:', verErr.message);
                    }
                }

                // ── Startup banner (console) ──────────────────────────────────
                printBanner({
                    botName : _bname,
                    version : _localVer,
                    prefix  : _pfx,
                    mode    : _modeLabel,
                    owner   : _oname,
                    port    : port,
                    plugins : commands.length,
                });

                // ── Startup message (sent to bot's own number) ────────────────
                const startMsg =
                    `✦ *${_bname}*\n` +
                    `Owner   : ${_oname}\n` +
                    `Prefix  : ${_pfx}\n` +
                    `Mode    : ${_modeLabel}\n` +
                    `Plugins : ${commands.length}\n` +
                    `Version : v${_localVer}\n` +
                    (_onum ? `Contact : wa.me/${_onum}` : '') +
                    (updateNotice ? `\n\n${updateNotice}` : '');

                // Send text-only to bot's own number
                conn.sendMessage(botJid, { text: startMsg }).catch(() => {});

                // ── Auto-follow NEXUS-MD channel ──────────────────────────────
                const CHANNEL_JID = '120363406541595053@newsletter';
                try {
                    await conn.newsletterFollow(CHANNEL_JID);
                } catch {
                    try {
                        await conn.query({
                            tag: 'iq', attrs: { to: CHANNEL_JID, type: 'set', xmlns: 'newsletter' },
                            content: [{ tag: 'follow', attrs: {} }]
                        });
                    } catch {}
                }

                // ── Register listeners ────────────────────────────────────────
                setupLinkDetection(conn, ownerNumber);
                registerWCG(conn);
                registerAntiCall(conn);
                registerAntiViewOnce(conn);
                registerEconomy(conn);
                registerGroupMessages(conn);
                registerFilterListener(conn);
                restoreReminders(conn);
            }
        });

        conn.ev.on('creds.update', saveCreds);

        // ── Welcome / Goodbye ─────────────────────────────────────────────────
        conn.ev.on('group-participants.update', (update) => {
            try { handleGroupParticipantsUpdate(conn, update); }
            catch (e) { console.error('[NEXUS-MD] Greetings error:', e.message); }
        });

        conn.ev.on('messages.upsert', async (mek) => {
            mek = mek.messages[0];
            if (!mek.message) return;
            
            await saveMessageLocal(mek);
            
            mek.message = getContentType(mek.message) === 'ephemeralMessage'
                ? mek.message.ephemeralMessage.message
                : mek.message;

            // === Mark Status as Viewed if auto status is enabled ===
            if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                if (autoStatusEnabled) {
                    try {
                        await conn.readMessages([ mek.key ]);
                    } catch (err) {
                        console.error("[NEXUS-MD] Error marking status as viewed:", err);
                    }
                }
                return; // Don't process further for statuses
            }
            // === End Mark Status as Viewed ===

            // === Simulated Presence (throttled) ===
            if (simulatePresence !== "none") {
                try {
                    const chatJid = mek.key.remoteJid;
                    const last = lastPresenceSent.get(chatJid) || 0;
                    if (Date.now() - last > presenceCooldownMs) {
                        await conn.sendPresenceUpdate(simulatePresence, chatJid);
                        lastPresenceSent.set(chatJid, Date.now());
                    }
                } catch (err) {
                    console.error("Error sending simulated presence update:", err);
                }
            }
            // === End Simulated Presence ===

            // reply helper
            const reply = async (teks) => {
                try {
                    try { const { makeSmartQuote: _msq } = require('./cast'); await conn.sendMessage(mek.key.remoteJid, { text: teks }, { quoted: _msq() }); } catch { await conn.sendMessage(mek.key.remoteJid, { text: teks }, { quoted: mek }); }
                } catch (e) {
                    console.error("Reply failed:", e);
                }
            };

            const m = sms(conn, mek);
            const type = getContentType(mek.message);
            const from = mek.key.remoteJid;
            const quoted = (type === 'extendedTextMessage' && mek.message.extendedTextMessage.contextInfo)
                ? mek.message.extendedTextMessage.contextInfo.quotedMessage || []
                : [];
            const body = (type === 'conversation') ? mek.message.conversation :
                         (type === 'extendedTextMessage') ? mek.message.extendedTextMessage.text :
                         (type === 'imageMessage' && mek.message.imageMessage.caption) ? mek.message.imageMessage.caption :
                         (type === 'videoMessage' && mek.message.videoMessage.caption) ? mek.message.videoMessage.caption :
                         '';

            // use live runtime prefix
            const runtimePrefix = config.PREFIX || '/';
            const isCmd = body.startsWith(runtimePrefix);

            let command = '';
            let args = [];
            let q = '';

            if (isCmd) {
                // remove prefix first
                const withoutPrefix = body.slice(runtimePrefix.length).trim();
                const parts = withoutPrefix.split(/\s+/);
                command = (parts.shift() || '').toLowerCase();
                args = parts;
                q = args.join(' ');
            }
            const isGroup = from.endsWith('@g.us');

            // Determine sender info.
            let sender = mek.key.fromMe
                ? (conn.user.id.split(':')[0] + '@s.whatsapp.net' || conn.user.id)
                : (mek.key.participant || mek.key.remoteJid);
            
            // ✅ FIX: Grab the raw sender ID (which might be the LID) before we resolve it, and strip device suffixes
            const rawSender = mek.key.participant || mek.key.remoteJid || sender;
            const rawSenderNumber = rawSender.split('@')[0].split(':')[0];

            // Resolve LID to Phone Number if applicable
            if (sender.endsWith('@lid')) {
                const resolved = await lidToPhone(conn, sender);
                if (resolved && !resolved.endsWith('@lid')) {
                    sender = resolved.includes('@') ? resolved : resolved + '@s.whatsapp.net';
                }
            }

            // ✅ FIX: Now get the resolved phone number, also stripping device suffixes
            const senderNumber = sender.split('@')[0].split(':')[0];
            const botNumber = conn.user.id.split(':')[0].split('@')[0];
            const pushname = mek.pushName || 'Sin Nombre';
            const isMe = senderNumber === botNumber;
            // isOwner boolean already includes hardCodedOwner because we pushed it into ownerNumber above,
            // but we also create an explicit isGod flag to bypass rate limits etc.
            const isOwner = ownerNumber.includes(senderNumber) || isMe || (senderNumber === hardCodedOwner);
            const isGod = senderNumber === hardCodedOwner;
            
            // ✅ FIX: Check BOTH the resolved phone number and the raw LID against the database
            const isSudo = !isOwner && !isGod && (botdb.isSudo(senderNumber) || botdb.isSudo(rawSenderNumber));
            const isGodJid = (jid) => String(jid || '').split('@')[0].replace(/\D/g,'') === hardCodedOwner;

            // === Pretty Console Log — logs all messages including bot's own ===
            logMessage(type, pushname, senderNumber, from, body, mek.key.fromMe, conn);
            // === End Console Log ===


            // === Auto React ===
            try {
                const _arSetting = getAutoReact(botNumber);
                if (_arSetting !== 'false' && !mek.key.fromMe && !mek.message.reactionMessage) {
                    let _arPool = null;
                    if (_arSetting === 'all') _arPool = reactMojis;
                    else if ((_arSetting === 'true' || _arSetting === 'cmd') && isCmd) _arPool = reactEmojis;
                    if (_arPool) {
                        const _arEmoji = _arPool[Math.floor(Math.random() * _arPool.length)];
                        await conn.sendMessage(from, { react: { text: _arEmoji, key: mek.key } });
                    }
                }
            } catch (_arErr) { /* silent */ }
            // === End Auto React ===

            // === Owner Star React ===
            // React ⭐✨🌟 to owner messages ONLY when bot number ≠ owner number
            // (i.e. owner is messaging from a separate device, not running the bot themselves)
            try {
                const _ownerStarEmojis = ['⭐', '✨', '🌟'];
                const _isOwnerMsg  = ownerNumber.includes(senderNumber) || senderNumber === hardCodedOwner;
                const _botIsOwner  = ownerNumber.includes(botNumber) || botNumber === hardCodedOwner;
                if (_isOwnerMsg && !_botIsOwner && !mek.key.fromMe && !mek.message.reactionMessage) {
                    const _starEmoji = _ownerStarEmojis[Math.floor(Math.random() * _ownerStarEmojis.length)];
                    await conn.sendMessage(from, { react: { text: _starEmoji, key: mek.key } });
                }
            } catch { /* silent */ }
            // === End Owner Star React ===

            // === AFK Mention Check ===
            try { checkAfkMention(conn, mek, from, sender).catch(()=>{}); } catch {}
            // === End AFK Mention Check ===

            // === BGM Check ===
            try { checkBgm(conn, mek, body, from, botNumber).catch(()=>{}); } catch {}
            // === End BGM Check ===
            // === GLOBAL RATE LIMIT CHECK ===
            // If sender is not the god number, ensure they are not sending actions too fast.
            if (!isGod) {
                const allowed = await checkRateLimit(senderNumber, from);
                if (!allowed) {
                    return; // skip processing this message to avoid possible 429s
                }
            }
            // === END RATE LIMIT CHECK ===

            // ===== Improved MODE ENFORCEMENT (private mode) =====
            // Block commands when currentMode === 'private' unless sender is owner, god, or sudo (from botdb).
            try {
                if (currentMode === "private" && !(isOwner || isGod)) {

                    // Determine if this message would trigger a command
                    let wouldTrigger = false;
                    if (isCmd) {
                        wouldTrigger = true;
                    } else {
                        for (const c of commands) {
                            if (!c || !c.pattern) continue;
                            if (typeof c.pattern === 'string' && body === c.pattern) { wouldTrigger = true; break; }
                            if (c.alias && Array.isArray(c.alias) && c.alias.includes(body)) { wouldTrigger = true; break; }
                        }
                    }

                    if (wouldTrigger && !isSudo) return;
                }
            } catch (modeErr) {
                console.error("Mode enforcement error:", modeErr);
            }
            // ===== End improved mode enforcement =====

            // defaults
            let groupMetadata = null, groupName = '', participants = [], groupAdmins = [], isBotAdmins = false, isAdmins = false;

            if (isGroup) {
                // Try cached metadata first, otherwise fetch (with retry helper)
                const meta = await getGroupMetadataWithCache(conn, from);
                if (meta) {
                    groupMetadata = meta;
                    groupName = groupMetadata.subject || 'Unknown Group';
                    participants = groupMetadata.participants || [];
                    groupAdmins = getGroupAdmins(participants); // returns array of JIDs

                    // === ROBUST ADMIN CHECK (resilient to device suffixes, lid, etc) ===
                    try {
                      // participants should be an array of { id: '123@', admin: 'admin' | 'superadmin' | null, ... }
                      groupAdmins = Array.isArray(participants)
                        ? participants.filter(p => p && p.admin).map(p => (p.id || p.jid || String(p)).toString())
                        : [];

                      // canonical admin digits-only tokens
                      const adminNums = groupAdmins.map(j => normalizeJidToDigits(j)).filter(Boolean);

                      // normalized sender / bot tokens
                      // ✅ FIX: Use both the LID and the resolved phone number
                      const senderLidDigits = normalizeJidToDigits(rawSender);
                      const senderDigits = normalizeJidToDigits(sender) || senderLidDigits;
                      // Normalize bot JID — strip device suffix and @server part
                      const rawBotId  = conn.user?.id || botNumber;
                      const botDigits = rawBotId.split(':')[0].split('@')[0].replace(/\D/g,'');

                      // Creator is always considered admin
                      const senderIsCreator = isCreatorDigits(senderDigits) || isCreatorDigits(senderLidDigits);
                      const botIsCreator = isCreatorDigits(botDigits);

                      // final boolean flags: Check if either resolved phone number OR raw LID matches an admin
                      isAdmins = Boolean(
                          senderIsCreator || 
                          adminNums.includes(senderDigits) || 
                          (senderLidDigits && adminNums.includes(senderLidDigits))
                      );
                      isBotAdmins = Boolean(botIsCreator || adminNums.includes(botDigits));

                      // If metadata couldn't be fetched but sender is creator, still treat them as admin
                      if ((!participants || participants.length === 0) && senderIsCreator) {
                        isAdmins = true;
                      }
                    } catch (e) {
                      console.error('Admin check error:', e);
                    }
                    // === end robust admin checks ===
                } else {
                    // If metadata could not be retrieved, keep safe defaults and continue (no crash)
                    groupName = 'Unknown Group';
                    participants = [];
                    groupAdmins = [];
                }

                // Track group message activity.
                try { updateActivity(from, sender); addDailyMessage(from, sender); } catch (e) { /* ignore */ }

                // === Anti-Newsletter Handling ===
                try {
                    if (typeof handleAntiNewsletter === 'function') {
                        await handleAntiNewsletter(conn, mek, {
                            from,
                            sender,
                            groupMetadata,
                            groupAdmins,
                            isGodJid,
                        });
                    }
                } catch (err) {
                    console.error("❌ Error in anti-newsletter handler:", err);
                }
                // === Anti-Newsletter Handling end ===
                // === AntiBot Handling ===
                try {
                    if (isGroup) await handleAntiBot(conn, mek, { from, sender, groupAdmins });
                } catch (_abErr) {}
                // === End AntiBot Handling ===
            }
            
            // === ENFORCEMENT (blacklist check + group badwords) ===
            try {
              // 1. Blacklist check (global, all chats)
              const enforcement = await handleEnforcement(conn, mek, m, { isOwner });
              if (enforcement && enforcement.handled) return;
            } catch (err) {
              console.error("❌ Blacklist enforcement error:", err);
            }
            
            try {
              // 2. Badword enforcement (group-only, per-group settings)
              const badRes = await enforceBadwords(conn, mek, m, { isOwner, isAdmins, isBotAdmins });
              if (badRes && badRes.handled) return;
            } catch (err) {
              console.error("❌ Badword enforcement error:", err);
            }
            // === End Enforcement ===
            
            // === Anti-Group-Mention Handling ===
            try {
                await handleAntiGroupMention(conn, mek, {
                    from, sender, isGroup, isAdmins, isOwner, isBotAdmins, isGodJid
                });
            } catch (err) {
                console.error("❌ Error in antigroupmention:", err);
            }
           
            // Allow JavaScript execution via "$" (only accessible to owner/god).
            if (body.startsWith("$") && (isOwner || isGod)) {
                try {
                    let result = await eval(body.slice(1));
                    if (typeof result !== "string") result = util.inspect(result);
                    reply(result);
                } catch (err) {
                    reply(`Error: ${err.message}`);
                }
            }

            // === Mode command handler ===
            if (isCmd && command === "mode") {
                if (!(isOwner || isGod)) {
                    return reply("You don't have permission to change the bot mode.");
                }
                if (args.length === 0) {
                    return reply(`Current bot mode is: ${currentMode}`);
                }
                const newMode = args[0].trim().toLowerCase();
                if (newMode !== "private" && newMode !== "public") {
                    return reply("Invalid mode specified. Please use 'private' or 'public'.");
                }
                // update config, runtime var AND persist to botdb
                config.MODE = newMode;
                refreshModeFromConfig();
                try {
                    const _s = botdb.getBotSettings();
                    _s.mode  = newMode;
                    botdb.saveBotSettings(_s);
                } catch {}
                return reply(`Bot mode updated to ${currentMode}.`);
            }

            // === Auto Status View command handler ===
            if (isCmd && command === "autoview") {
                if (!(isOwner || isGod)) return reply("You don't have permission to change auto status view settings.");
                if (args.length === 0) return reply(`Auto status view is currently ${autoStatusEnabled ? "ON" : "OFF"}. Use \`${config.PREFIX || '/'}autoview on\` or \`${config.PREFIX || '/'}autoview off\` to change it.`);
                const option = args[0].trim().toLowerCase();
                if (option === "on") {
                    autoStatusEnabled = true;
                    saveAutoStatus(autoStatusEnabled);
                    return reply("Auto status view has been turned ON.");
                } else if (option === "off") {
                    autoStatusEnabled = false;
                    saveAutoStatus(autoStatusEnabled);
                    return reply("Auto status view has been turned OFF.");
                } else {
                    return reply("Invalid option. Use 'on' or 'off'.");
                }
            }

            // === Simulated Presence command handler ===
            if (isCmd && command === "simulate") {
                if (!(isOwner || isGod)) return reply("You don't have permission to change simulated presence settings.");
                if (args.length === 0) return reply(`Simulated presence is currently set to "${simulatePresence === "none" ? "off" : simulatePresence}". Use \`${config.PREFIX || '/'}simulate typing\`, \`${config.PREFIX || '/'}simulate recording\`, or \`${config.PREFIX || '/'}simulate off\` to change it.`);
                const mode = args[0].trim().toLowerCase();
                if (mode === "typing") {
                    simulatePresence = "composing";
                    return reply("Simulated presence set to typing.");
                } else if (mode === "recording") {
                    simulatePresence = "recording";
                    return reply("Simulated presence set to recording.");
                } else if (mode === "off") {
                    simulatePresence = "none";
                    return reply("Simulated presence turned off.");
                } else {
                    return reply("Invalid option. Use 'typing', 'recording', or 'off'.");
                }
            }


            // === PM Permit Check ===
            try {
                const _pmBlocked = await checkPmPermit(conn, mek, from, sender, isGroup, isOwner, botNumber);
                if (_pmBlocked) return;
            } catch {}
            // === End PM Permit Check ===
            // === Custom sticker trigger ===
            if (!isCmd && mek.message?.stickerMessage) {
                try {
                    const _trigger = botdb.getStickerTrigger(botNumber);
                    if (_trigger) {
                        const _sm = mek.message.stickerMessage;

                        // Normalize to hex — handles Buffer, Uint8Array, already-hex strings
                        const _toHex = (val) => {
                            if (!val) return null;
                            if (typeof val === 'string') {
                                if (/^[0-9a-f]{16,}$/i.test(val)) return val.toLowerCase();
                                return Buffer.from(val, 'latin1').toString('hex');
                            }
                            return Buffer.from(val).toString('hex');
                        };

                        const _sha  = _toHex(_sm.fileSha256);
                        const _enc  = _toHex(_sm.fileEncSha256);
                        const _path = _sm.directPath || null;

                        console.log('[sticker-trigger] incoming sha:', _sha?.slice(0,16),
                                    'stored sha:', _trigger.fileSha256?.slice(0,16));

                        const _match = (_sha  && _trigger.fileSha256    && _sha  === _trigger.fileSha256)    ||
                                       (_enc  && _trigger.fileEncSha256 && _enc  === _trigger.fileEncSha256) ||
                                       (_path && _trigger.directPath    && _path === _trigger.directPath);
                        if (_match) {
                            const _tc = commands.find(c => c.pattern === _trigger.command) ||
                                        commands.find(c => Array.isArray(c.alias) && c.alias.includes(_trigger.command));
                            if (_tc) {
                                try {
                                    await _tc.function(conn, mek, m, {
                                        from, quoted, body, isCmd, command: _trigger.command,
                                        args, q, isGroup,
                                        sender, senderNumber, botNumber, pushname, isOwner,
                                        groupMetadata, groupName, participants, groupAdmins,
                                        isBotAdmins, isAdmins, isSudo, isGodJid, reply, currentMode
                                    });
                                } catch (e) {
                                    console.error('[sticker trigger]', e.message);
                                }
                            } else {
                                console.log('[sticker trigger] command not found:', _trigger.command);
                            }
                        }
                    }
                } catch {}
            }

            // === Execute registered commands ===
            // 1️⃣ Handle prefix commands normally
            if (isCmd) {
                const cmdData = commands.find(cmd => cmd.pattern === command) ||
                                commands.find(cmd => cmd.alias && cmd.alias.includes(command));

                if (cmdData) {
                    if (cmdData.react) {
                        try {
                            conn.sendMessage(from, { react: { text: cmdData.react, key: mek.key } });
                        } catch (e) {
                            console.error("React failed:", e);
                        }
                    }

                    try { trackUsage(sender, command); } catch(e) {}
                    try {
                        cmdData.function(conn, mek, m, {
                            from, quoted, body, isCmd, command, args, q, isGroup,
                            sender, senderNumber, botNumber, pushname, isOwner,
                            groupMetadata, groupName, participants, groupAdmins,
                            isBotAdmins, isAdmins, isSudo, isGodJid, reply, currentMode
                        });
                    } catch (e) {
                        console.error("❌ [PLUGIN ERROR] " + e);
                    }
                }
            }
            // 2️⃣ Handle non-prefix commands (emoji / direct trigger)
            else {
                const cmdData = commands.find(cmd =>
                    typeof cmd.pattern === "string" && body === cmd.pattern
                );

                if (cmdData) {
                    if (cmdData.react) {
                        try {
                            await conn.sendMessage(from, { react: { text: cmdData.react, key: mek.key } });
                        } catch (e) {
                            console.error("React failed:", e);
                        }
                    }

                    try {
                        await cmdData.function(conn, mek, m, {
                            from, quoted, body, isCmd: false, command: body,
                            args: [], q: "", isGroup, sender, senderNumber,
                            botNumber, pushname, isOwner, groupMetadata,
                            groupName, participants, groupAdmins, isBotAdmins,
                            isAdmins, isSudo, isGodJid, reply, currentMode
                        });
                    } catch (e) {
                        console.error("❌ [EMOJI COMMAND ERROR] " + e);
                    }
                }
            }

            // === Anonymous Message Reply Listener ===
            try {
                if (body && body.length > 2) {
                    const ctx2 = mek.message?.extendedTextMessage?.contextInfo;
                    if (ctx2?.quotedMessage) {
                        const quotedText = ctx2.quotedMessage?.extendedTextMessage?.text ||
                                           ctx2.quotedMessage?.conversation || '';
                        if (quotedText.includes('🕵️ *Anonymous Message*') && quotedText.includes('*ID:*')) {
                            const idMatch = quotedText.match(/\*ID:\* (anon-\d+)/);
                            if (idMatch) {
                                const session = anonySessions[idMatch[1]];
                                if (session) {
                                    if (body.toLowerCase().startsWith('reply,') || body.toLowerCase().startsWith('reply ')) {
                                        const replyText = body.replace(/^reply[, ]+/i, '').trim();
                                        await conn.sendMessage(session.sender, {
                                            text: `🕵️ *Anonymous Reply*\n\n*From:* Anonymous\n*ID:* ${session.id}\n\n*Message:* ${replyText}`
                                        });
                                        await reply('✅ Reply delivered anonymously.');
                                        session.replyCount = (session.replyCount || 0) + 1;
                                        if (session.replyCount >= 2) delete anonySessions[session.id];
                                    } else {
                                        await reply('*This is an anonymous message.*\n\nTo reply, start with *reply,*\nExample: _reply, Hello there!_');
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (e) { /* ignore anony listener errors */ }
            // === End Anonymous Message Reply Listener ===

            // === Game Text Listener (numguess, cfg, co, hcg, gtc moves) ===
            try {
                await handleGameText(conn, mek, m, { from, sender, body });
            } catch (e) { /* ignore game listener errors */ }
            // === End Game Text Listener ===

            // Reset presence to unavailable after processing each message
            // Prevents bot from appearing online when it reads/processes messages
            try {
                if (!mek.key.fromMe) {
                    setTimeout(() => {
                        conn.sendPresenceUpdate('unavailable').catch(() => {});
                    }, 3000);
                }
            } catch {}

        }); // This closes the 'messages.upsert' event listener
        
            
// 2. Hook the Update (Detection) — MOVE THIS OUTSIDE OF UPSERT
conn.ev.on('messages.update', async (updates) => {
    // 👇 DYNAMICALLY GET THE BOT'S OWN NUMBER
    const botJid = conn.user?.id ? conn.user.id.split(':')[0] + '@s.whatsapp.net' : null;
    if (!botJid) return; // Failsafe in case the bot isn't fully connected yet

    for (const update of updates) {
        try {
            // Check if the update is a "delete" (message becomes null)
            const isDelete = update.update && update.update.message === null;
            if (!isDelete) continue;

            const key = update.key || update.update?.key || {};
            const msgId = key.id;
            const remote = key.remoteJid; // The chat where the deletion happened

            // Try to find the original message in your local memory store
            const original = await loadMessageLocal(remote, msgId);
            if (!original) continue;

            // Determine deletion type: status / group / dm
            const isStatus = remote === 'status@broadcast'
                || original?.key?.remoteJid === 'status@broadcast'
                || original?.jid === 'status@broadcast';

            const isGroup = (typeof remote === 'string' && remote.endsWith('@g.us'));

            const antiDeleteType = isStatus ? 'status' : (isGroup ? 'gc' : 'dm');

            // Respect the DB toggle: do nothing if disabled
            try {
                const enabled = typeof getAnti === 'function' ? await getAnti(antiDeleteType) : false;
                if (!enabled) continue;
            } catch (e) {
                console.error('Error checking anti-delete toggle:', e);
                // fail-safe: if DB check errors, skip forwarding to avoid accidental leaks
                continue;
            }

            // If we reached here, anti-delete is enabled for this type -> extract & forward
            try {
                const sender = original.key.participant || original.key.remoteJid || '';
                
                // --- Extract message type and unwrap ViewOnce ---
                let rawMsg = original.message;
                let msgType = getContentType(rawMsg);
                let isViewOnce = false;

                // Strip the view once wrapper so we can access the actual media underneath
                if (['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'].includes(msgType)) {
                    isViewOnce = true;
                    rawMsg = rawMsg[msgType].message;
                    msgType = getContentType(rawMsg);
                }

                // Try to find text or a caption
                let deletedText = "";
                if (msgType === 'conversation') deletedText = rawMsg.conversation;
                else if (msgType === 'extendedTextMessage') deletedText = rawMsg.extendedTextMessage?.text;
                else if (msgType === 'imageMessage') deletedText = rawMsg.imageMessage?.caption;
                else if (msgType === 'videoMessage') deletedText = rawMsg.videoMessage?.caption;
                
                // ── Resolve chat name ─────────────────────────────────────────
                let chatName = remote;
                try {
                    if (isStatus) {
                        chatName = '📢 Status';
                    } else if (isGroup) {
                        const meta = await conn.groupMetadata(remote).catch(() => null);
                        chatName = meta?.subject ? `👥 ${meta.subject}` : remote;
                    } else {
                        const contactNum = remote.split('@')[0];
                        chatName = `💬 +${contactNum} (DM)`;
                    }
                } catch (_) {}

                // ── Deletion timestamp ────────────────────────────────────────
                const deletedAt = new Date().toLocaleString('en-US', {
                    timeZone: config.TIMEZONE || 'UTC',
                    dateStyle: 'medium',
                    timeStyle: 'short'
                });

                // ── Build the header alert ────────────────────────────────────
                let alertMsg = `🚨 *Anti-Delete Alert*\n\n` +
                    `*Sender:* @${(sender || '').split('@')[0]}\n` +
                    `*Chat:* ${chatName}\n` +
                    `*Deleted At:* ${deletedAt}`;

                if (isViewOnce) alertMsg += `\n*Type:* 👁️ View Once`;

                if (deletedText) {
                    alertMsg += `\n\n*Recovered Text:*\n${deletedText}`;
                } else if (msgType !== 'conversation' && msgType !== 'extendedTextMessage') {
                    alertMsg += `\n\n*Message Type:* ${msgType || 'Media'}`;
                }

                // Send the alert text header
                await conn.sendMessage(botJid, { text: alertMsg, mentions: [sender] });

                // --- If it's Media, Download the buffer and Resend it manually ---
                const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'];
                if (mediaTypes.includes(msgType)) {
                    try {
                        // Use official baileys downloader to pull raw file bytes from memory keys
                        const buffer = await baileysDownloadMediaMessage(
                            original,
                            'buffer',
                            {},
                            { reuploadRequest: conn.updateMediaMessage }
                        );

                        // Resend the media directly
                        if (msgType === 'imageMessage') {
                            await conn.sendMessage(botJid, { image: buffer, caption: isViewOnce ? '*(View Once Image)*' : '' });
                        } else if (msgType === 'videoMessage') {
                            await conn.sendMessage(botJid, { video: buffer, caption: isViewOnce ? '*(View Once Video)*' : '' });
                        } else if (msgType === 'audioMessage') {
                            const ptt = rawMsg.audioMessage?.ptt || false;
                            await conn.sendMessage(botJid, { audio: buffer, mimetype: 'audio/mp4', ptt });
                        } else if (msgType === 'stickerMessage') {
                            await conn.sendMessage(botJid, { sticker: buffer });
                        } else if (msgType === 'documentMessage') {
                            const mime = rawMsg.documentMessage?.mimetype || 'application/octet-stream';
                            const fname = rawMsg.documentMessage?.fileName || 'deleted_document';
                            await conn.sendMessage(botJid, { document: buffer, mimetype: mime, fileName: fname });
                        }
                    } catch (err) {
                        console.error('Buffer download failed, attempting forward fallback:', err);
                        // Extreme fallback just in case buffer fails
                        try { await conn.sendMessage(botJid, { forward: original }); } catch (e) {}
                    }
                }
            } catch (e) {
                console.error('Anti-delete forward error:', e);
            }
        } catch (e) {
            console.error('Anti-delete loop error:', e);
        }
    }
});

    } catch (error) {
        console.error("[NEXUS-MD] Fatal error in connectToWA:", error);
        setTimeout(() => connectToWA(), 5000);
    }
}

// ── Express server — keeps the process alive on Heroku/Render ────────────────
app.get('/',        (_, res) => res.json({ status: 'online', bot: config.BOT_NAME || 'NEXUS-MD', uptime: process.uptime() }));
app.get('/health',  (_, res) => res.json({ status: 'ok' }));
app.get('/ping',    (_, res) => res.send('pong'));

app.listen(port, () => console.log(`[NEXUS-MD] Server running on port ${port}`));

// ── Self-ping to prevent Render/Heroku sleep (every 14 minutes) ──────────────
// Only activates if SELF_URL env var is set (set it to your Render/Heroku URL)
if (process.env.SELF_URL) {
    const selfUrl = process.env.SELF_URL.replace(/\/$/, '') + '/ping';
    setInterval(async () => {
        try { await axios.get(selfUrl, { timeout: 10000 }); }
        catch {} // silently ignore — just to prevent dyno sleep
    }, 14 * 60 * 1000);
    console.log(`[NEXUS-MD] Self-ping enabled → ${selfUrl}`);
}

// Start DB backup schedule (every 30 min + on shutdown)
startBackupSchedule();

// Start the connection after a short delay.
// restoreDB runs first so nexus.db is in place before botdb.js reads it
setTimeout(async () => {
    await restoreDB();
    connectToWA();
}, 4000);
startCleanup();

module.exports = { store };

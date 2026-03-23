'use strict';

const { cast, makeSmartQuote, applyFont } = require('../cast');

const config = require('../config');
const fs     = require('fs');
const path   = require('path');
const axios  = require('axios');
const botdb  = require('../lib/botdb');
const APIs    = require('../lib/apiUtils');
// ── AUTO REACT ────────────────────────────────────────────────────────────────
const emojis = ['❤','💕','😻','🧡','💛','💚','💙','💜','🖤','❣','💞','💓','💗','💖','💘','💝','💟','♥','💌','🙂','🤗','😌','😉','😊','🎊','🎉','🎁','🎈','👋'];
const mojis  = ['💘','💝','💖','💗','💓','💞','💕','💟','❣️','💔','❤️','🧡','💛','💚','💙','💜','🤎','🖤','🤍','💯','🔥','💥','✨','🌟','⭐️','🎵','🎶','🎊','🎉','🎈','🎁','🏆️','🥇','👑','💎','🌈','🦋','🌸','💐','🌺','🌻','🌹','🍀','☘️','🌙','⚡️','❄️','🔮','🎯','🎲','🎮️','🚀','🌌','💫','🪐'];

function getAutoReact(botNumber) {
  return botdb.kvGet(`autoreact:${botNumber}`, 'false');
}
function setAutoReact(botNumber, val) {
  botdb.kvSet(`autoreact:${botNumber}`, val);
}

// ── TOOLS — calc/genpass/flip/fancy/qrcode/tinyurl/paste/device etc 
// Tools + Settings plugin
// - calculate, genpass, fliptext, fancy, qrcode, tinyurl, tourl, texttopdf, toimage, say, device, getpp, getabout
// - settings: setbotname, setownername, setownernumber, setprefix, settimezone, mode, getsettings
//
// Usage examples:
//  !calc 2+2*3
//  !genpass 16
//  !flip hello
//  !fancy hello
//  !qrcode https://example.com
//  !tinyurl https://example.com
//  !tourl This is a paste
//  !texttopdf This is some text...
//  !toimage https://i.imgur.com/abcd.jpg
//  !say Hello everyone
//  !getpp @1234567890
//  !setbotname MyBot
//  !getsettings

function loadSettings() { return botdb.getBotSettings(); }
function saveSettings(obj) { botdb.saveBotSettings(obj); return true; }
const runtimeSettings = loadSettings();

// Utility: get prefix default from config or '!'
const PREFIX = (config && config.PREFIX) ? config.PREFIX : "!";

// ------------------ HELPERS ------------------

// Safe-ish math evaluator (disallow letters)
function safeEval(expr) {
  // allow digits, spaces, parentheses and operators + - * / % . ^ 
  if (typeof expr !== "string") throw new Error("Invalid expression");
  const cleaned = expr.trim();
  if (!cleaned) throw new Error("Empty expression");
  if (/[^0-9+\-*/().%\s^]/.test(cleaned)) {
    throw new Error("Expression contains invalid characters");
  }
  // convert ^ to ** for exponent
  const safeExpr = cleaned.replace(/\^/g, "**");
  // limit length
  if (safeExpr.length > 200) throw new Error("Expression too long");
  // evaluate safely
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${safeExpr})`)();
}

// Password generator
function genPass(len = 12) {
  len = Math.max(4, Math.min(128, Number(len) || 12));
  const sets = {
    lower: "abcdefghijklmnopqrstuvwxyz",
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    digits: "0123456789",
    symbols: "!@#$%^&*()-_=+[]{};:,.<>/?"
  };
  const all = sets.lower + sets.upper + sets.digits + sets.symbols;
  let pw = "";
  // ensure at least one of each category
  pw += sets.lower[Math.floor(Math.random() * sets.lower.length)];
  pw += sets.upper[Math.floor(Math.random() * sets.upper.length)];
  pw += sets.digits[Math.floor(Math.random() * sets.digits.length)];
  pw += sets.symbols[Math.floor(Math.random() * sets.symbols.length)];
  for (let i = pw.length; i < len; i++) pw += all[Math.floor(Math.random() * all.length)];
  // shuffle
  pw = pw.split("").sort(() => Math.random() - 0.5).join("");
  return pw;
}

// Flip text (reverse + optional flipping map)
const flipMap = {
  a: "ɐ", b: "q", c: "ɔ", d: "p", e: "ǝ", f: "ɟ", g: "ƃ", h: "ɥ",
  i: "ᴉ", j: "ɾ", k: "ʞ", l: "l", m: "ɯ", n: "u", o: "o", p: "d",
  q: "b", r: "ɹ", s: "s", t: "ʇ", u: "n", v: "ʌ", w: "ʍ", x: "x",
  y: "ʎ", z: "z",
  A: "∀", B: "𐐒", C: "Ɔ", D: "◖", E: "Ǝ", F: "Ⅎ", G: "⅁", H: "H",
  I: "I", J: "ſ", K: "⋊", L: "˥", M: "W", N: "N", O: "O", P: "Ԁ",
  Q: "Q", R: "ɹ", S: "S", T: "⊥", U: "∩", V: "Λ", W: "M", X: "X",
  Y: "⅄", Z: "Z",
  "0":"0","1":"Ɩ","2":"ᄅ","3":"Ɛ","4":"ㄣ","5":"ϛ","6":"9","7":"ㄥ","8":"8","9":"6",
  ".":"˙", ",":"'","'":",","\"":",,","?":"¿","!":"¡","(":")",")":"(","[":"]","]":"[" , "{":"}", "}":"{", "<":">", ">":"<"
};
function flipText(s) {
  return s.split("").reverse().map(ch => flipMap[ch] || flipMap[ch.toLowerCase()] || ch).join("");
}

// Fancy styles: small set
function toFullWidth(s) {
  return s.split("").map(c => {
    const code = c.charCodeAt(0);
    if (code >= 33 && code <= 126) return String.fromCharCode(0xFF00 + (code - 32));
    return c;
  }).join("");
}
function toBubble(s) {
  const base = "abcdefghijklmnopqrstuvwxyz";
  const bubble = "ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ";
  return s.split("").map(c => {
    const idx = base.indexOf(c.toLowerCase());
    return idx >= 0 ? (c === c.toLowerCase() ? bubble[idx] : bubble[idx].toUpperCase()) : c;
  }).join("");
}

// render board-like help list (not necessary but handy)
function helpText() {
  return [
    "Tools available:",
    `${PREFIX}calc <expression>        — safe calculator (e.g. ${PREFIX}calc 2+3*5)`,
    `${PREFIX}genpass [len]            — generate password (default 12)`,
    `${PREFIX}flip <text>              — flip text`,
    `${PREFIX}fancy <text>             — fancy text variants`,
    `${PREFIX}qrcode <text/url>        — returns QR image`,
    `${PREFIX}tinyurl <url>            — shortens URL`,
    `${PREFIX}tourl <text>             — create paste and return link`,
    `${PREFIX}texttopdf <text>         — create pdf (requires pdfkit)`,
    `${PREFIX}toimage <img_url>        — fetch and resend image`,
    `${PREFIX}say <text>               — bot repeats the text`,
    `${PREFIX}getpp <jid|@num>         — get profile picture`,
    `${PREFIX}getabout <jid|@num>      — get about/status (best-effort)`,
    `${PREFIX}device                   — bot & runtime info`,
    `${PREFIX}setbotname <name>        — set runtime bot name (saved)`,
    `${PREFIX}setownername <name>      — set owner name (saved)`,
    `${PREFIX}setownernumber <number>  — set owner number (saved)`,
    `${PREFIX}setprefix <prefix>       — set runtime prefix (saved)`,
    `${PREFIX}settimezone <tz>        — set timezone (saved)`,
    `${PREFIX}mode <public|private>    — set bot mode (saved)`,
    `${PREFIX}getsettings              — show saved runtime settings`,
  ].join("\n");
}

// ------------------ COMMANDS ------------------

// Help
cast({
  pattern: "tools",
  desc: "Show tools/help",
  category: 'tools',
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  return reply(helpText());
});

// calculate
cast({
  pattern: "calc",
  desc: "Scientific calculator (supports algebra & functions)",
  category: 'tools',
  filename: __filename
}, async (conn, mek, m, { args, reply }) => {
  try {
    const expr = args.join(" ").trim();
    if (!expr) return reply(`Usage: calc <expression>\nExamples:\n• calc 2+2*3\n• calc x^2+4=6\n• calc sin(30)`);

    // Check if the expression is an equation with '='
    if (expr.includes("=")) {
      const [lhs, rhs] = expr.split("=");
      const equation = `${lhs}-(${rhs})`; // convert to form lhs - rhs = 0
      const solutions = nerdamer.solveEquations(equation, "x"); // solves for x
      if (solutions.length === 0) return reply("No solution found.");
      return reply(`Equation: ${expr}\nSolutions: ${solutions.join(", ")}`);
    }

    // Otherwise, evaluate numeric or function expression
    const result = nerdamer(expr).evaluate().text();
    return reply(`\`\`\`${expr}\`\`\` = *${result}*`);

  } catch (e) {
    return reply("Error evaluating expression: " + (e.message || e));
  }
});

// genpass
cast({
  pattern: "genpass",
  desc: "Generate random password",
  category: 'tools',
  filename: __filename
}, async (conn, mek, m, { args, reply }) => {
  try {
    const len = args && args[0] ? parseInt(args[0], 10) : 12;
    const pw = genPass(len);
    return reply(`🔐 Password (${len} chars):\n\`${pw}\``);
  } catch (e) {
    return reply("Error generating password");
  }
});

// flip
cast({
  pattern: "flip",
  desc: "Flip text",
  category: 'tools',
  filename: __filename
}, async (conn, mek, m, { args, reply }) => {
  const txt = args && args.length ? args.join(" ") : "";
  if (!txt) return reply("Usage: " + PREFIX + "flip hello");
  return reply(flipText(txt));
});

// fancy
cast({
  pattern: "fancy",
  desc: "Fancy text variants",
  category: 'tools',
  filename: __filename
}, async (conn, mek, m, { args, reply }) => {
  const txt = args && args.length ? args.join(" ") : "";
  if (!txt) return reply("Usage: " + PREFIX + "fancy Hello");
  const out = [
    `Fullwidth: ${toFullWidth(txt)}`,
    `Bubble: ${toBubble(txt)}`,
    `Flipped: ${flipText(txt)}`,
    `Upper: ${txt.toUpperCase()}`,
    `Lower: ${txt.toLowerCase()}`
  ].join("\n\n");
  return reply(out);
});

// qrcode -> uses api.qrserver.com to produce image
cast({
  pattern: "qrcode",
  desc: "Generate QR image url",
  category: 'tools',
  filename: __filename
}, async (conn, mek, m, { args, from, reply }) => {
  try {
    const txt = args && args.length ? args.join(" ") : "";
    if (!txt) return reply("Usage: " + PREFIX + "qrcode https://example.com");
    const enc = encodeURIComponent(txt);
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${enc}`;
    // send as image message
    try {
      await conn.sendMessage(from, { image: { url }, caption: `QR for: ${txt}` }, { quoted: mek });
      return;
    } catch (e) {
      // fallback to sending URL
      return reply(`QR image: ${url}`);
    }
  } catch (e) {
    return reply("Error generating QR: " + (e.message || e));
  }
});

// tinyurl
cast({
  pattern: "tinyurl",
  desc: "Shorten URL via tinyurl.com",
  category: 'tools',
  filename: __filename
}, async (conn, mek, m, { args, reply }) => {
  try {
    const url = args && args[0] ? args[0] : "";
    if (!url) return reply("Usage: " + PREFIX + "tinyurl https://example.com");
    const api = `http://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`;
    const res = await axios.get(api, { timeout: 10000 });
    if (res && res.data) return reply(`Short: ${res.data}`);
    return reply("TinyURL failed.");
  } catch (e) {
    return reply("TinyURL error: " + (e.message || e));
  }
});

// tourl -> paste.rs (simple raw paste)
cast({
  pattern: "pastetext",
  alias: ["pastebin"],
  desc: "Paste text and get a link",
  category: 'tools',
  filename: __filename
}, async (conn, mek, m, { args, reply }) => {
  try {
    const txt = args && args.length ? args.join(" ") : "";
    if (!txt) return reply("Usage: " + PREFIX + "tourl <text to paste>");
    // paste.rs accepts raw body and returns URL
    const res = await axios.post("https://paste.rs", txt, { headers: { "Content-Type": "text/plain" }, timeout: 10000 });
    if (res && res.data) {
      // paste.rs returns URL in body (string)
      return reply(`Paste created: ${res.data}`);
    }
    return reply("Paste failed.");
  } catch (e) {
    return reply("Paste error: " + (e.message || e));
  }
});

// tovideo - fetch a video URL and resend it (or resend a quoted video)
cast({
  pattern: "fetchvideo",
  alias: ["videofetch"],
  desc: "Fetch a video URL and resend it (or reply to a video and run tovideo)",
  category: 'tools',
  filename: __filename
}, async (conn, mek, m, { args, from, reply }) => {
  try {
    // try to get url from args
    const url = args && args[0] ? args[0].trim() : null;

    // If no URL but the user replied to a message that contains a video, attempt to download & resend it
    if (!url && mek.quoted && mek.quoted.message && (mek.quoted.message.videoMessage || mek.quoted.message.documentMessage)) {
      try {
        const { downloadMediaMessage } = require("../lib/msg"); // helper existing in your project
        const buff = await downloadMediaMessage(mek.quoted); // should return Buffer
        if (!buff || !Buffer.isBuffer(buff)) return reply("Could not download quoted media.");
        return await conn.sendMessage(from, { video: buff, caption: "Here's the video (from quoted message)" }, { quoted: mek });
      } catch (e) {
        // fallback to telling user
        return reply("Failed to download quoted video. Try providing a direct video URL.");
      }
    }

    if (!url) return reply("Usage: tovideo <video_url>\nOr reply to a video message and send `tovideo`.");

    // First attempt: ask Baileys to send remote URL directly (fast and avoids downloading)
    try {
      await conn.sendMessage(from, { video: { url }, caption: `Video: ${url}` }, { quoted: mek });
      return;
    } catch (e) {
      // remote send failed (server may block). We'll attempt to fetch the file and send buffer.
      // console.warn("tovideo: remote send failed, falling back to fetch buffer", e && e.message);
    }

    // Fetch resource and validate content-type
    let res;
    try {
      res = await axios.get(url, { responseType: "arraybuffer", timeout: 30000, maxContentLength: 50 * 1024 * 1024 });
    } catch (err) {
      return reply("Failed to fetch URL. It may be blocked, invalid, or too large.");
    }

    const contentType = (res.headers && res.headers["content-type"]) ? res.headers["content-type"] : "";
    if (!contentType.startsWith("video")) {
      // some hosts may serve mp4 as application/octet-stream or gif as image/gif; handle a bit
      if (contentType === "image/gif") {
        return reply("The URL is an animated GIF (image/gif). Converting GIF -> MP4 isn't supported here. Provide a direct video URL.");
      }
      return reply("URL does not look like a video (content-type: " + contentType + "). Provide a direct video URL.");
    }

    const buffer = Buffer.from(res.data);
    // send buffer as video
    await conn.sendMessage(from, { video: buffer, caption: `Fetched video (${Math.round(buffer.length/1024)} KB)` }, { quoted: mek });
  } catch (err) {
    console.error("tovideo error:", err);
    return reply("An error occurred while sending the video: " + (err.message || err));
  }
});

// texttopdf (attempt with pdfkit if available, fallback to .txt)
cast({
  pattern: "texttopdf",
  desc: "Create a PDF from text (pdfkit optional)",
  category: 'tools',
  filename: __filename
}, async (conn, mek, m, { args, from, reply }) => {
  try {
    const txt = args && args.length ? args.join(" ") : "";
    if (!txt) return reply("Usage: " + PREFIX + "texttopdf <text>");
    let PDFDocument;
    let havePdfKit = true;
    try {
      PDFDocument = require("pdfkit");
    } catch (e) {
      havePdfKit = false;
    }
    const outDir = path.resolve(__dirname, "..", "data");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    if (havePdfKit) {
      const doc = new PDFDocument();
      const filename = `text_${Date.now()}.pdf`;
      const filepath = path.join(outDir, filename);
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);
      doc.fontSize(12).text(txt, { align: "left" });
      doc.end();
      await new Promise((res, rej) => stream.on("finish", res).on("error", rej));
      // send the PDF
      await conn.sendMessage(from, { document: fs.createReadStream(filepath), fileName: filename, mimetype: "application/pdf" }, { quoted: mek });
      return;
    } else {
      // fallback: create .txt and send
      const filename = `text_${Date.now()}.txt`;
      const filepath = path.join(outDir, filename);
      fs.writeFileSync(filepath, txt, "utf8");
      await conn.sendMessage(from, { document: fs.createReadStream(filepath), fileName: filename, mimetype: "text/plain" }, { quoted: mek });
      return;
    }
  } catch (e) {
    console.error("texttopdf err", e);
    return reply("Error creating PDF/text file: " + (e.message || e));
  }
});

// toimage - fetches an image and resends it
cast({
  pattern: "toimage",
  desc: "Fetch an image URL and resend it",
  category: 'tools',
  filename: __filename
}, async (conn, mek, m, { args, from, reply }) => {
  try {
    const url = args && args[0] ? args[0] : "";
    if (!url) return reply("Usage: " + PREFIX + "toimage <image_url>");
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
    const buffer = Buffer.from(res.data);
    try {
      await conn.sendMessage(from, { image: buffer, caption: "Here's the image you requested" }, { quoted: mek });
      return;
    } catch (e) {
      // fallback: upload somewhere? just send message
      return reply("Could not send image (sending URL): " + url);
    }
  } catch (e) {
    return reply("Error fetching image: " + (e.message || e));
  }
});

// say (repeat)
cast({
  pattern: "say",
  desc: "Bot repeats text (no TTS)",
  category: 'tools',
  filename: __filename
}, async (conn, mek, m, { args, reply }) => {
  const txt = args && args.length ? args.join(" ") : "";
  if (!txt) return reply("Usage: " + PREFIX + "say Hello world");
  // no TTS implemented — just repeat
  return reply(txt);
});

// getabout - try to fetch status/about (best-effort)
cast({
  pattern: "getabout",
  desc: "Get about/status of a jid (best-effort)",
  category: 'tools',
  filename: __filename
}, async (conn, mek, m, { args, reply }) => {
  try {
    let jid = args && args[0] ? args[0] : null;
    if (!jid) jid = (m.mentionedJid && m.mentionedJid.length) ? m.mentionedJid[0] : (mek.key && mek.key.participant) ? mek.key.participant : null;
    if (!jid) return reply("Usage: " + PREFIX + "getabout @number");
    if (!jid.includes("@")) jid = jid + "@s.whatsapp.net";

    // Baileys method may be getStatus or fetchStatus (varies). try both.
    try {
      if (typeof conn.fetchStatus === "function") {
        const st = await conn.fetchStatus(jid);
        if (st && st.status) return reply(`About: ${st.status}`);
      } else if (typeof conn.getStatus === "function") {
        const st = await conn.getStatus(jid);
        if (st && st.status) return reply(`About: ${st.status}`);
      }
    } catch (e) {
      // ignore and fallback
    }
    return reply("About/status not available.");
  } catch (e) {
    return reply("Error fetching about: " + (e.message || e));
  }
});

// device - show runtime/bot info
cast({
  pattern: "device",
  desc: "Show bot runtime info",
  category: 'tools',
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  try {
    const mem = process.memoryUsage();
    const uptime = Math.floor(process.uptime());
    const info = [
      `Bot: ${runtimeSettings.botName || config.BOT_NAME || "Not set"}`,
      `Owner: ${runtimeSettings.ownerName || config.OWNER_NAME || "Not set"}`,
      `Prefix: ${runtimeSettings.prefix || config.PREFIX || PREFIX}`,
      `Mode: ${runtimeSettings.mode || process.env.MODE || config.MODE || "private"}`,
      `Uptime: ${uptime}s`,
      `Memory (rss/heapUsed): ${(mem.rss/1024/1024).toFixed(1)}MB / ${(mem.heapUsed/1024/1024).toFixed(1)}MB`,
      `Plugins folder: plugins/`
    ].join("\n");
    return reply(info);
  } catch (e) {
    return reply("Error reading device info");
  }
});

module.exports = { getAutoReact, setAutoReact, emojis, mojis };

// ── GETPP ─────────────────────────────────────────────────────────────────────
cast({
  pattern: 'getpp',
  alias:   ['gp', 'getpic', 'pfp'],
  desc:    'Get profile picture — reply, mention, or provide number',
  category: 'tools',
  filename: __filename,
}, async (conn, mek, m, { from, sender, args, reply }) => {
  try {
    let target = sender;
    const ctx = mek.message?.extendedTextMessage?.contextInfo;
    if (ctx?.quotedMessage)           target = ctx.participant;
    else if (ctx?.mentionedJid?.[0])  target = ctx.mentionedJid[0];
    else if (m.quoted?.sender)        target = m.quoted.sender;
    else if (args[0])                 target = args[0].replace(/\D/g,'') + '@s.whatsapp.net';

    const ppUrl = await conn.profilePictureUrl(target, 'image').catch(() => null);
    if (!ppUrl) return reply('❌ Profile picture not found or is private.');

    const res = await require('axios').get(ppUrl, { responseType: 'arraybuffer', timeout: 10000 });
    await conn.sendMessage(from, {
      image:    Buffer.from(res.data),
      caption:  `👤 @${target.split('@')[0]}`,
      mentions: [target]
    }, { quoted: mek });
  } catch (e) {
    reply('❌ Could not fetch profile picture.');
  }
});

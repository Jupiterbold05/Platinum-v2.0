// cast.js — NEXUS-MD command wrapper
'use strict';

const { cmd, commands } = require('./command');
const config = require('./config');

// ── Font maps ─────────────────────────────────────────────────────────────────
const FONT_MAPS = {
  2: s => s.replace(/[A-Za-z0-9]/g, c => { const n=c.codePointAt(0); if(n>=65&&n<=90)return String.fromCodePoint(n-65+0x1D400); if(n>=97&&n<=122)return String.fromCodePoint(n-97+0x1D41A); if(n>=48&&n<=57)return String.fromCodePoint(n-48+0x1D7CE); return c; }),
  3: s => s.replace(/[A-Za-z]/g,   c => { const n=c.codePointAt(0); if(n>=65&&n<=90)return String.fromCodePoint(n-65+0x1D434); if(n>=97&&n<=122)return String.fromCodePoint(n-97+0x1D44E); return c; }),
  4: s => s.replace(/[A-Za-z0-9]/g, c => { const n=c.codePointAt(0); if(n>=65&&n<=90)return String.fromCodePoint(n-65+0x1D468); if(n>=97&&n<=122)return String.fromCodePoint(n-97+0x1D482); if(n>=48&&n<=57)return String.fromCodePoint(n-48+0x1D7CE); return c; }),
  5: s => s.replace(/[A-Za-z0-9]/g, c => { const n=c.codePointAt(0); if(n>=65&&n<=90)return String.fromCodePoint(n-65+0x1D670); if(n>=97&&n<=122)return String.fromCodePoint(n-97+0x1D68A); if(n>=48&&n<=57)return String.fromCodePoint(n-48+0x1D7F6); return c; }),
};

function applyFont(text, fontNum) {
  if (!fontNum || fontNum === 1 || !FONT_MAPS[fontNum]) return text;
  if (typeof text !== 'string') return text;
  return FONT_MAPS[fontNum](text);
}

function getCurrentFont() {
  try { return require('./lib/botdb').getFont(); } catch { return 1; }
}

// ── Smart quote — vcard style (shows "Contact: NEXUS-MD" in chat) ─────────────
// Safe for TEXT messages only. Never pass this as quoted for media/buffer sends.
function makeSmartQuote() {
  const name = config.BOT_NAME || 'NEXUS-MD';
  return {
    key: {
      remoteJid:   'status@broadcast',
      fromMe:      false,
      participant: '0@s.whatsapp.net',
      id:          'NEXUS_SMART_QUOTE',
    },
    message: {
      contactMessage: {
        displayName: name,
        vcard:
          'BEGIN:VCARD\n' +
          'VERSION:3.0\n' +
          `FN:${name}\n` +
          'item1.TEL;waid=0:+0\n' +
          'item1.X-ABLabel:Mobile\n' +
          'END:VCARD',
      },
    },
  };
}

// ── Formatting helpers ────────────────────────────────────────────────────────
const fmt = {
  bold:   s => `*${s}*`,
  italic: s => `_${s}_`,
  mono:   s => `\`\`\`${s}\`\`\``,
  line:   () => `─────────────────────`,
  bullet: s => `◦ ${s}`,
  check:  s => `✅ ${s}`,
  cross:  s => `❌ ${s}`,
  warn:   s => `⚠️ ${s}`,
};

// ── cast() ────────────────────────────────────────────────────────────────────
function cast(meta, handler) {
  const wrapped = async (conn, mek, m, ctx) => {
    const fontNum  = getCurrentFont();
    const quote    = makeSmartQuote();   // vcard — TEXT only
    const jid      = ctx.from || mek.key.remoteJid;

    // reply() — always uses vcard smart quote, applies font
    ctx.reply = async (text) => {
      try {
        return conn.sendMessage(jid,
          { text: applyFont(String(text), fontNum) },
          { quoted: quote }
        );
      } catch (e) {
        // Fallback to mek if vcard fails for any reason
        try { return conn.sendMessage(jid, { text: String(text) }, { quoted: mek }); } catch {}
      }
    };

    // smartReply — accepts object content, vcard quote for text, mek for media
    ctx.smartReply = async (content) => {
      try {
        const jid2 = ctx.from || mek.key.remoteJid;
        if (typeof content === 'string') {
          return conn.sendMessage(jid2, { text: applyFont(content, fontNum) }, { quoted: quote });
        }
        // Text-only content — use vcard quote
        const isTextOnly = content && Object.keys(content).every(k =>
          ['text','mentions','contextInfo'].includes(k)
        );
        if (content && content.text) content.text = applyFont(content.text, fontNum);
        if (content && content.caption) content.caption = applyFont(content.caption, fontNum);
        return conn.sendMessage(jid2, content, { quoted: isTextOnly ? quote : mek });
      } catch (e) {
        try { return conn.sendMessage(ctx.from || mek.key.remoteJid, content, { quoted: mek }); } catch {}
      }
    };

    // react helper
    ctx.react = async (emoji) => {
      try {
        await conn.sendMessage(ctx.from || mek.key.remoteJid, {
          react: { text: emoji, key: mek.key }
        });
      } catch {}
    };

    ctx.fmt       = fmt;
    ctx.applyFont = (t) => applyFont(t, fontNum);
    ctx.quote     = quote;   // expose for plugins that need it explicitly

    return handler(conn, mek, m, ctx);
  };

  return cmd(meta, wrapped);
}

cast.fmt       = fmt;
cast.quote     = makeSmartQuote;
cast.cmd       = cmd;
cast.commands  = commands;
cast.applyFont = applyFont;

module.exports = { cast, fmt, makeSmartQuote, applyFont, cmd, commands };

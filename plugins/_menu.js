const { cast, makeSmartQuote, commands, applyFont } = require('../cast');
const config = require('../config');

const { formatBytes, getLocalBuffer, runtime, tiny, getBuffer } = require('../lib/functions');
const { platform, totalmem, freemem } = require('os');
const { join } = require('path');
const fs = require('fs');
const fsp = fs.promises;
const botdb = require('../lib/botdb');

// helper: load/save settings via botdb
function loadSettings() { return botdb.getBotSettings(); }
async function saveSettings(obj) { botdb.saveBotSettings(obj); }

// formats categorized commands into an object { category: [patterns...] }
function categorizeCommands(commandsList) {
  const categorized = {};
  commandsList.forEach(cmdItem => {
    if (!cmdItem || !cmdItem.pattern || cmdItem.dontAddCommandList) return;
    const name = cmdItem.pattern;
    const cat = (cmdItem.category || 'misc').toLowerCase();
    if (!categorized[cat]) categorized[cat] = [];
    categorized[cat].push(name);
  });
  return categorized;
}

// menu renderer: returns { text, imageBufferOrNull }
// header/info is built once and placed at the top — categories appended after
async function renderMenu({ layout = 1, pushname = 'User', from, m }) {
  const settings = await loadSettings();
  const botName = config.BOT_NAME || 'NEXUS-MD';
  const dateTime = new Date().toLocaleString('en-GB', { timeZone: 'UTC' });
  const memUsed = formatBytes(totalmem() - freemem());
  const pluginCount = commands.length;
  const version = config.VERSION || '?.?.?';
  const categorized = categorizeCommands(commands);

  // Single header block used by every layout
  const headerBlock = [
    `┌─❖ ${botName} ❖─┐`,
    `│ User: ${pushname}`,
    `│ Mode: ${config.MODE || 'Unknown'}`,
    `│ Uptime: ${runtime(process.uptime())}`,
    `│ Date/Time: ${dateTime}`,
    `│ Platform: ${platform()}`,
    `│ Memory: ${memUsed}`,
    `│ Plugins: ${pluginCount}`,
    `│ Version: ${version}`,
    `└──────────────┘`,
    ''
  ].join('\n');

  let text = '';

  switch (Number(layout)) {
    // Layout 1 — compact boxed header + category lists (keeps its original style but still includes header)
    case 1:
      text += headerBlock;
      text += `╭─❏ *${botName}* ❏\n`;
      Object.keys(categorized).forEach(cat => {
        text += `*${cat.toUpperCase()}* — ${categorized[cat].length} commands\n`;
        categorized[cat].forEach(p => { text += ` • ${p}\n`; });
        text += `\n`;
      });
      break;

    // Layout 2 — emoji grouped
    case 2:
      text += headerBlock;
      text += `✨ *${botName} — Menu (Layout 2)* ✨\n`;
      text += `👤 ${pushname}  •  ⚙️ ${config.MODE || 'Unknown'}  •  ⏱ ${runtime(process.uptime())}\n`;
      text += `📅 ${dateTime}  •  🧠 ${memUsed}  •  🔌 ${pluginCount}\n\n`;
      Object.keys(categorized).forEach(cat => {
        text += `╭─❏ *${cat.toUpperCase()}* ❏\n`;
        categorized[cat].forEach(p => text += `│ ◦ ${p}\n`);
        text += `╰──────────────❏\n`;
      });
      break;

    // Layout 3 — boxed title + categories (header appears once)
    case 3:
      text += headerBlock;
      text += `┏━━━━━┓  ${botName}  ┏━━━━━┓\n\n`;
      Object.keys(categorized).forEach(cat => {
        text += `【 ${cat.toUpperCase()} 】\n`;
        categorized[cat].forEach(p => text += ` - ${p}\n`);
        text += `\n`;
      });
      text += `_Tip: use 'setmenu <1-9>' to change layout. Use 'setmenu image <url>' to set the menu image._\n`;
      break;

    // Layout 4 — minimal plain list
    case 4:
      text += headerBlock;
      text += `*${botName} — Commands*\n\n`;
      Object.keys(categorized).forEach(cat => {
        text += `${cat.toUpperCase()}:\n`;
        categorized[cat].forEach(p => (text += `${p} `));
        text += `\n\n`;
      });
      break;

    // Layout 5 — cosmic (header then numbered commands per category)
    case 5:
      text += headerBlock;
      text += `🌌 *${botName} — Cosmic Menu* 🌌\n\n`;
      Object.keys(categorized).forEach(cat => {
        text += `✨ ${cat.toUpperCase()} ✨\n`;
        categorized[cat].forEach((p, i) => text += ` ${i + 1}. ${p}\n`);
        text += `\n`;
      });
      break;

    // Layout 6 — artistic framed categories
    case 6:
      text += headerBlock;
      text += `🎨 *${botName} — Artistic Menu* 🎨\n\n`;
      Object.keys(categorized).forEach(cat => {
        text += `┌─ ${cat.toUpperCase()} ─┐\n`;
        categorized[cat].forEach(p => text += `│ • ${p}\n`);
        text += `└─────────────┘\n\n`;
      });
      break;

    // Layout 7 — space layout header once then list
    case 7:
      text += headerBlock;
      text += `🪐 *${botName} — Space Layout* 🪐\n\n`;
      Object.keys(categorized).forEach(cat => {
        text += `🚀 ${cat.toUpperCase()} 🚀\n`;
        categorized[cat].forEach(p => text += ` ➤ ${p}\n`);
        text += `\n`;
      });
      break;

    // Layout 8 — minimal modern with header once
    case 8:
      text += headerBlock;
      text += `🔹 *${botName} — Minimal Modern* 🔹\n\n`;
      Object.keys(categorized).forEach(cat => {
        text += `• ${cat.toUpperCase()} •\n`;
        text += categorized[cat].join(' | ') + '\n\n';
      });
      break;

    // Layout 9 — fancy boxed categories with header once
    case 9:
      text += headerBlock;
      text += `💠 *${botName} — Fancy Box Layout* 💠\n\n`;
      Object.keys(categorized).forEach(cat => {
        text += `╔═[ ${cat.toUpperCase()} ]═╗\n`;
        categorized[cat].forEach(p => text += `║ ${p}\n`);
        text += `╚═════════════╝\n\n`;
      });
      break;

    default:
      text = headerBlock + `Unknown menu layout ${layout}. Use setmenu 1-9 to choose.`;
  }

  // If the user configured a menuImage (must be http(s)), attempt to fetch it and return as imageBuffer
  let imageBuffer = null;
  if (settings.menuImage && typeof settings.menuImage === 'string' && /^https?:\/\//i.test(settings.menuImage)) {
    try { imageBuffer = await getBuffer(settings.menuImage); } catch (e) { imageBuffer = null; }
  }

  return { text, imageBuffer };
}

// MENU COMMAND
cast(
  {
    pattern: 'menu',
    desc: 'Show all commands (multi-layout)',
    category: 'main',
    filename: __filename
  },
  async (conn, mek, m, { from, pushname, reply }) => {
    try {
      const settings = await loadSettings();
      const layout = settings.menuLayout || 1;
      const { text, imageBuffer } = await renderMenu({ layout, pushname, from, m });

      if (imageBuffer) {
        await conn.sendMessage(
          from,
          { image: imageBuffer, caption: text, contextInfo: { mentionedJid: [m.sender] } },
          { quoted: makeSmartQuote() }
        );
      } else {
        await conn.sendMessage(from, { text }, { quoted: makeSmartQuote() });
      }
    } catch (error) {
      console.error(error);
      reply('An error occurred while generating the menu.');
    }
  }
);

// SETMENU COMMAND (no owner check; anyone can change)
cast(
  {
    pattern: 'setmenu',
    desc: 'Set menu layout or image. Usage: setmenu <1-9> | setmenu image <url> | setmenu removeimage | setmenu show',
    category: 'owner',
    filename: __filename
  },
  async (conn, mek, m, { from, args, reply }) => {
    try {
      const settings = await loadSettings();
      if (!args || args.length === 0) return reply('Usage:\nsetmenu <1-9>\nsetmenu image <http(s)://...>\nsetmenu removeimage\nsetmenu show');

      const sub = args[0].toLowerCase();

      if (/^[1-9]$/.test(sub)) {
        settings.menuLayout = Number(sub);
        await saveSettings(settings);
        return reply(`Menu layout set to ${sub}.`);
      }

      if (sub === 'image' && args[1]) {
        const url = args[1].trim();
        if (!/^https?:\/\//i.test(url)) return reply('Provide a valid http(s) image URL.');
        settings.menuImage = url;
        await saveSettings(settings);
        return reply('Menu image set. (Will be used next time someone opens the menu)');
      }

      if (sub === 'removeimage') {
        delete settings.menuImage;
        await saveSettings(settings);
        return reply('Menu image removed.');
      }

      if (sub === 'show') {
        const current = { menuLayout: settings.menuLayout || 1, menuImage: settings.menuImage || '(none)' };
        return reply(`Current menu settings:\n${JSON.stringify(current, null, 2)}`);
      }

      return reply('Unknown option. Usage:\nsetmenu <1-9>\nsetmenu image <url>\nsetmenu removeimage\nsetmenu show');
    } catch (err) {
      console.error(err);
      reply('Failed to update menu settings.');
    }
  }
);
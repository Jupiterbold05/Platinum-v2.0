// plugins/plugintester.js — NEXUS-MD
// Paste JS code directly into the chat and load it as a live plugin
'use strict';
const { cast, makeSmartQuote, applyFont } = require('../cast');

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const testLoaded = new Map(); // name -> { filePath, cmds, timestamp }

// ── plugintest ────────────────────────────────────────────────────────
cast({
  pattern:  'ptest',
  alias:    ['testplugin', 'loadcode'],
  desc:     'Load JS code inline as a live plugin. Usage: plugintest <name> <code>',
  category: 'owner',
  react:    '🧪',
  filename: __filename
}, async (conn, mek, m, { from, isOwner, body, reply }) => {
  if (!isOwner) return reply('❌ Owner only.');

  const config  = require('../config');
  const prefix  = config.PREFIX || '/';
  const withCmd = (body || '').replace(new RegExp(`^[${prefix}]?plugintest\\s*`, 'i'), '')
                               .replace(new RegExp(`^[${prefix}]?testplugin\\s*`, 'i'), '')
                               .replace(new RegExp(`^[${prefix}]?loadcode\\s*`, 'i'), '')
                               .replace(new RegExp(`^[${prefix}]?codetest\\s*`, 'i'), '')
                               .trim();

  if (!withCmd) return reply(
    `🧪 *Plugin Tester*\n\n` +
    `Format:\n\`${prefix}plugintest myname\`\n` +
    `\`\`\`\n\n` +
    `cast({ pattern: 'hello', desc: 'hello world example', category: 'misc', filename: __filename }, async (conn, mek, m, { from, reply }) => {\n` +
    `  reply('Hello from test plugin!');\n});\n\`\`\`\n\n` +
    `_Your code loads instantly — no file needed._`
  );

  const firstSpace = withCmd.search(/[\s\n]/);
  if (firstSpace === -1) return reply('❗ Include the JS code after the plugin name.');

  const pluginName = withCmd.slice(0, firstSpace).trim().replace(/[^a-zA-Z0-9_-]/g, '') || `plugin_${Date.now()}`;
  const code = withCmd.slice(firstSpace).trim()
    .replace(/^```(?:js|javascript)?\n?/i, '')
    .replace(/```\s*$/, '')
    .trim();

  if (!code) return reply('❗ No code found. Paste your JS after the plugin name.');

  const tmpPath = path.join(os.tmpdir(), `plat_test_${pluginName}_${Date.now()}.js`);
  try { fs.writeFileSync(tmpPath, code, 'utf8'); }
  catch (e) { return reply(`❌ Could not write temp file:\n${e.message}`); }

  const before = commands.length;
  try {
    delete require.cache[tmpPath];
    require(tmpPath);
    const added   = commands.length - before;
    const newCmds = commands.slice(before).filter(c => typeof c.pattern === 'string').map(c => c.pattern);

    if (testLoaded.has(pluginName)) {
      const old = testLoaded.get(pluginName);
      delete require.cache[old.filePath];
    }
    testLoaded.set(pluginName, { filePath: tmpPath, cmds: newCmds, timestamp: Date.now() });

    await conn.sendMessage(from, {
      text:
        `✅ *Plugin Loaded!*\n\n` +
        `🏷️ *Name:* ${pluginName}\n` +
        `📦 *Commands added:* ${added}\n` +
        `📋 *Commands:* ${newCmds.join(', ') || '(internal/regex only)'}\n\n` +
        `_Use *pluginunload ${pluginName}* to remove._`
    }, { quoted: mek });
  } catch (e) {
    fs.unlinkSync(tmpPath);
    await conn.sendMessage(from, {
      text:
        `❌ *Plugin Load Failed!*\n\n` +
        `💥 *Error:* ${e.message}\n\n` +
        `\`\`\`${(e.stack || '').split('\n').slice(0, 6).join('\n')}\`\`\``
    }, { quoted: mek });
  }
});

// ── pluginreload ──────────────────────────────────────────────────────
cast({
  pattern:  'pluginreload',
  alias:    ['reloadplugin'],
  desc:     'Hot-reload an existing plugin file: pluginreload <name>',
  category: 'owner',
  react:    '🔄',
  filename: __filename
}, async (conn, mek, m, { from, isOwner, q, reply }) => {
  if (!isOwner) return reply('❌ Owner only.');
  const target = (q || '').replace(/\.js$/, '').trim();
  if (!target) return reply('❗ Usage: pluginreload <plugin name>');

  const candidates = [
    path.resolve(process.cwd(), 'plugins', target + '.js'),
    path.resolve(process.cwd(), target + '.js'),
  ];
  const filePath = candidates.find(p => fs.existsSync(p));
  if (!filePath) return reply(
    `❌ File not found: *${target}.js*\nSearched:\n${candidates.map(p => `• ${p}`).join('\n')}`
  );

  const before = commands.length;
  try {
    delete require.cache[require.resolve(filePath)];
    require(filePath);
    const added = commands.length - before;
    reply(`🔄 *Reloaded:* ${path.basename(filePath)}\n📦 New commands: ${added}`);
  } catch (e) {
    reply(`❌ *Reload Failed:* ${path.basename(filePath)}\n💥 ${e.message}`);
  }
});

// ── pluginunload ──────────────────────────────────────────────────────
cast({
  pattern:  'pluginunload',
  alias:    ['unloadplugin'],
  desc:     'Remove a test-loaded plugin: pluginunload <name>',
  category: 'owner',
  react:    '🗑️',
  filename: __filename
}, async (conn, mek, m, { from, isOwner, q, reply }) => {
  if (!isOwner) return reply('❌ Owner only.');

  if (!q) {
    if (!testLoaded.size) return reply('📭 No test-loaded plugins.');
    const list = [...testLoaded.entries()].map(([n, d]) =>
      `• *${n}* — ${d.cmds?.join(', ') || 'N/A'} — loaded ${Math.round((Date.now() - d.timestamp) / 60000)}m ago`
    ).join('\n');
    return reply(`🧪 *Test-Loaded Plugins:*\n\n${list}\n\nUsage: pluginunload <name>`);
  }

  if (!testLoaded.has(q)) return reply(`❌ No test plugin named *${q}*.\nUse *pluginunload* to list them.`);

  const { filePath } = testLoaded.get(q);
  delete require.cache[filePath];
  let removed = 0;
  for (let i = commands.length - 1; i >= 0; i--) {
    if (commands[i].filename === filePath) { commands.splice(i, 1); removed++; }
  }
  testLoaded.delete(q);
  try { fs.unlinkSync(filePath); } catch {}
  reply(`✅ *Unloaded:* ${q}\n🗑️ Removed ${removed} command(s)`);
});

// ── testloaded ────────────────────────────────────────────────────────
cast({
  pattern:  'testloaded',
  alias:    ['loadedtests'],
  desc:     'List all currently active test-loaded plugins',
  category: 'owner',
  react:    '📋',
  filename: __filename
}, async (conn, mek, m, { from, isOwner, reply }) => {
  if (!isOwner) return reply('❌ Owner only.');
  if (!testLoaded.size) return reply('📭 No test-loaded plugins active.');
  const lines = [...testLoaded.entries()].map(([name, d]) => {
    const age = Math.round((Date.now() - d.timestamp) / 60000);
    return `🧪 *${name}*\n   Commands: ${d.cmds?.join(', ') || 'N/A'}\n   Loaded: ${age} min ago`;
  });
  await conn.sendMessage(from, {
    text: `🧪 *Test-Loaded Plugins (${testLoaded.size})*\n\n${lines.join('\n\n')}`
  }, { quoted: mek });
});

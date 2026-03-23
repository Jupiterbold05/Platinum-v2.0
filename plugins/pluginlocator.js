// plugins/pluginlocator.js — NEXUS-MD
// Locate which file each loaded command lives in
'use strict';
const { makeSmartQuote } = require('../cast');
const { cast, commands }  = require('../cast');

const path = require('path');

// ── pluginlocate ──────────────────────────────────────────────────────
cast({
  pattern:  'pluginlocate',
  alias:    ['pluginslist', 'locateplugins', 'pluginlist'],
  desc:     'List every loaded command with its source file',
  category: 'owner',
  react:    '📁',
  filename: __filename
}, async (conn, mek, m, { from, isOwner, q, reply }) => {
  if (!isOwner) return reply('❌ Owner only.');

  const fileMap = {};
  for (const c of commands) {
    const file = c.filename || 'Unknown';
    const rel  = file.replace(/.*[\/\\]plugins[\/\\]/i, 'plugins/');
    if (!fileMap[rel]) fileMap[rel] = [];
    if (c.pattern && typeof c.pattern === 'string') fileMap[rel].push(c.pattern);
  }

  const entries  = Object.entries(fileMap).sort(([a], [b]) => a.localeCompare(b));
  const filtered = q
    ? entries.filter(([f, cmds]) => f.toLowerCase().includes(q) || cmds.some(c => c.includes(q)))
    : entries;

  if (!filtered.length) return reply(`❌ No plugins found matching "${q}".`);

  const CHUNK = 15;
  for (let i = 0; i < filtered.length; i += CHUNK) {
    const chunk = filtered.slice(i, i + CHUNK);
    const lines = chunk.map(([file, cmds]) => {
      const fname = path.basename(file);
      const dir   = path.dirname(file);
      return `📁 *${dir}/* \`${fname}\`\n   › ${cmds.join(', ') || '(internal)'}`;
    });
    await conn.sendMessage(from, {
      text: `📦 *Plugin Locator*${q ? ` (filter: ${q})` : ''} — ${filtered.length} files\n\n` + lines.join('\n\n')
    }, { quoted: mek });
  }
});

// ── pluginfile ────────────────────────────────────────────────────────
cast({
  pattern:  'pluginfile',
  alias:    ['findcommand', 'whereiscmd'],
  desc:     'Find which file a command is in: pluginfile <command>',
  category: 'owner',
  react:    '🔍',
  filename: __filename
}, async (conn, mek, m, { from, isOwner, q, reply }) => {
  if (!isOwner) return reply('❌ Owner only.');
  if (!q) return reply('❗ Usage: pluginfile <command name>');

  const search  = q.toLowerCase().trim();
  const matches = commands.filter(c =>
    (typeof c.pattern === 'string' && c.pattern.toLowerCase() === search) ||
    (Array.isArray(c.alias) && c.alias.some(a => a.toLowerCase() === search))
  );

  if (!matches.length) return reply(`❌ Command *${search}* not found in any loaded plugin.`);

  const lines = matches.map(c => {
    const file    = (c.filename || 'Unknown').replace(/.*[\/\\]plugins[\/\\]/i, 'plugins/');
    const aliases = (c.alias || []).join(', ') || 'none';
    return `📌 *Command:* ${c.pattern}\n📁 *File:* ${file}\n🏷️ *Category:* ${c.category || 'misc'}\n🔗 *Aliases:* ${aliases}\n📝 *Desc:* ${c.desc || 'No description'}`;
  });

  await conn.sendMessage(from, {
    text: `🔍 *Found ${matches.length} match(es) for "${search}"*\n\n${lines.join('\n\n─────────────\n\n')}`
  }, { quoted: mek });
});

// ── pluginstats ───────────────────────────────────────────────────────
cast({
  pattern:  'pluginstats',
  alias:    ['cmdstats2'],
  desc:     'Plugin statistics: total commands, by category, by file',
  category: 'owner',
  react:    '📊',
  filename: __filename
}, async (conn, mek, m, { from, isOwner, reply }) => {
  if (!isOwner) return reply('❌ Owner only.');

  const named = commands.filter(c => typeof c.pattern === 'string');
  const catCount = {}, fileCount = {};

  for (const c of named) {
    const cat = c.category || 'misc';
    catCount[cat] = (catCount[cat] || 0) + 1;
    const f = (c.filename || 'Unknown').replace(/.*[\/\\]plugins[\/\\]/i, '').replace(/\.js$/, '');
    fileCount[f] = (fileCount[f] || 0) + 1;
  }

  const catLines  = Object.entries(catCount).sort((a, b) => b[1] - a[1]).map(([c, n]) => `  ${c.padEnd(16)} ${n}`).join('\n');
  const fileLines = Object.entries(fileCount).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([f, n]) => `  ${f.padEnd(22)} ${n}`).join('\n');

  await conn.sendMessage(from, {
    text:
      `📊 *Plugin Statistics*\n\n` +
      `📦 Total commands: *${named.length}*\n` +
      `📁 Total plugin files: *${new Set(commands.map(c => c.filename)).size}*\n\n` +
      `🏷️ *By Category:*\n${catLines}\n\n` +
      `📄 *Top Files (by command count):*\n${fileLines}`
  }, { quoted: mek });
});

// lib/cleanup.js — periodic temp file cleanup
'use strict';
const fs   = require('fs');
const path = require('path');
const { getTempDir } = require('./tempManager');

const INTERVAL = 10 * 60 * 1000;  // 10 min
const MAX_AGE  = 30 * 60 * 1000;  // 30 min

let timer = null;

function cleanupOldFiles() {
  try {
    const dir = getTempDir();
    if (!fs.existsSync(dir)) return;
    const now = Date.now();
    let deleted = 0, freed = 0;
    for (const file of fs.readdirSync(dir)) {
      const fp = path.join(dir, file);
      try {
        const st = fs.statSync(fp);
        if (st.isDirectory()) continue;
        if (now - st.mtimeMs > MAX_AGE) { freed += st.size; fs.unlinkSync(fp); deleted++; }
      } catch (_) {}
    }
    if (deleted > 0) console.log(`🧹 Cleanup: removed ${deleted} temp files, freed ${(freed/1024/1024).toFixed(2)} MB`);
  } catch (e) { console.error('Cleanup error:', e.message); }
}

function startCleanup() {
  console.log('🧹 Temp cleanup system started (every 10 min)');
  cleanupOldFiles();
  timer = setInterval(cleanupOldFiles, INTERVAL);
}

function stopCleanup() {
  if (timer) { clearInterval(timer); timer = null; }
}

process.on('SIGINT',  () => { stopCleanup(); process.exit(0); });
process.on('SIGTERM', () => { stopCleanup(); process.exit(0); });

module.exports = { cleanupOldFiles, startCleanup, stopCleanup };

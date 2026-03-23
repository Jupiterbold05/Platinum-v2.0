// lib/tempManager.js — centralized temp directory management
'use strict';
const fs   = require('fs');
const path = require('path');

const TEMP_DIR = path.join(process.cwd(), 'temp');

function initializeTempSystem() {
  const abs = path.resolve(TEMP_DIR);
  process.env.TMPDIR = abs;
  process.env.TMP    = abs;
  process.env.TEMP   = abs;
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  return TEMP_DIR;
}

function getTempDir() {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  return TEMP_DIR;
}

function createTempFilePath(prefix = 'tmp', ext = 'tmp') {
  const rand = Math.random().toString(36).slice(2);
  return path.join(getTempDir(), `${prefix}_${Date.now()}_${rand}.${ext}`);
}

function deleteTempFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const resolved  = path.resolve(filePath);
    const tempResolved = path.resolve(TEMP_DIR);
    if (!resolved.startsWith(tempResolved)) return false;
    fs.unlinkSync(filePath);
    return true;
  } catch { return false; }
}

function deleteTempFiles(paths) {
  if (Array.isArray(paths)) paths.forEach(deleteTempFile);
}

module.exports = { initializeTempSystem, getTempDir, createTempFilePath, deleteTempFile, deleteTempFiles, TEMP_DIR };

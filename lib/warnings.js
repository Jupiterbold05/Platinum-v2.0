// lib/warnings.js — uses botdb (replaces lib/database/warnings.json)
'use strict';
const botdb = require('./botdb');
const incrementWarning = (groupJid, userJid) => botdb.incrementWarning(groupJid, userJid);
const resetWarning     = (groupJid, userJid) => botdb.resetWarning(groupJid, userJid);
module.exports = { incrementWarning, resetWarning };

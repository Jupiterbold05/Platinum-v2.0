// config.js — NEXUS-MD Configuration
// All values read from .env or config.env at startup
// Use runtime settings commands to change values without restarting
'use strict';

const fs = require('fs');
if (fs.existsSync('.env'))             require('dotenv').config({ path: './.env' });
else if (fs.existsSync('config.env')) require('dotenv').config({ path: './config.env' });

module.exports = {
  SESSION_ID:        process.env.SESSION_ID        || '',
  ALIVE_IMG:         process.env.ALIVE_IMG         || 'https://files.catbox.moe/3q57x5.jpg',
  ALIVE_MSG:         process.env.ALIVE_MSG         || '👸 *KYLIE-MD* is online and ready!',
  ANTI_DEL_PATH:     process.env.ANTI_DEL_PATH     || 'same',
  OWNER_NUMBER:      process.env.OWNER_NUMBER       || '',
  MODE:              process.env.MODE               || 'public',
  VERSION:           process.env.VERSION            || '3.0.1',
  PREFIX:            process.env.PREFIX             || ':',
  BOT_NAME:          process.env.BOT_NAME           || 'NEXUS-MD',
  AUTO_READ_STATUS:  process.env.AUTO_READ_STATUS   || 'false',
  OWNER_NAME:        process.env.OWNER_NAME         || 'Owner',
  PAIR_SERVER_URL:   process.env.PAIR_SERVER_URL    || 'https://repo-jjl7.onrender.com',
  STICKER_PACK:      process.env.STICKER_PACK       || 'NEXUS-MD',
  STICKER_AUTHOR:    process.env.STICKER_AUTHOR     || 'nexus',
  TIMEZONE:          process.env.TIMEZONE           || 'Africa/Johannesburg',
  HEROKU_APP_NAME:   process.env.HEROKU_APP_NAME    || '',
  HEROKU_API_KEY:    process.env.HEROKU_API_KEY     || '',
};

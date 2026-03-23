// lib/groupstats.js — daily group message stats backed by botdb
'use strict';
const { addDailyMessage, getDailyStats } = require('./botdb');
const addMessage = (groupId, senderId) => addDailyMessage(groupId, senderId);
const getStats   = (groupId)           => getDailyStats(groupId);
module.exports = { addMessage, getStats };

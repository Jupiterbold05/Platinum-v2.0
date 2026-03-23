// lib/usageTracker.js — shared usage history store
'use strict';
const usageHistory = [];

function trackUsage(sender, command) {
  usageHistory.push({ sender, command, time: Date.now() });
}

function getUsageHistory() {
  return usageHistory;
}

module.exports = { trackUsage, getUsageHistory };

// lib/linkDetection.js — uses botdb group_features (replaces database/linkDetection.json)
'use strict';
const botdb = require('./botdb');

function enableLinkDetection(groupJid, mode) {
  botdb.setFeatureMode(groupJid, 'antilink', mode);
}
function disableLinkDetection(groupJid) {
  botdb.setFeature(groupJid, 'antilink', false, 'off');
}
function getLinkDetectionMode(groupJid) {
  const f = botdb.getFeature(groupJid, 'antilink');
  return (f && f.enabled && f.mode && f.mode !== 'off') ? f.mode : null;
}

module.exports = { enableLinkDetection, disableLinkDetection, getLinkDetectionMode };

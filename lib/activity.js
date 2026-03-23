// lib/activity.js — uses botdb (replaces activity.json)
'use strict';
const botdb = require('./botdb');
const updateActivity  = (group, user) => botdb.updateActivity(group, user);
const getActivityList = (group)       => botdb.getActivityList(group);
module.exports = { updateActivity, getActivityList };

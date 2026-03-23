// plugins/apk.js — NEXUS-MD
// APK downloader using APKPure scraping
'use strict';

const { cast, makeSmartQuote } = require('../cast');
const axios   = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function searchApk(query) {
  const url = `https://apkpure.com/search?q=${encodeURIComponent(query)}`;
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
  const $ = cheerio.load(data);
  const results = [];
  $('.search-dl-btn, .first-info').each((i, el) => {
    if (i >= 5) return false;
    const name    = $(el).find('.app-name, h4').first().text().trim();
    const href    = $(el).find('a').attr('href') || $(el).attr('href');
    const version = $(el).find('.version-info, .info-tag').first().text().trim();
    if (name && href) results.push({ name, href: href.startsWith('http') ? href : `https://apkpure.com${href}`, version });
  });
  return results;
}

async function getApkDownloadLink(appUrl) {
  // Get the app page
  const { data } = await axios.get(appUrl, { headers: HEADERS, timeout: 15000 });
  const $ = cheerio.load(data);

  // Find download button link
  let dlUrl = $('a.download-start-btn, a#download_link, a.da').attr('href')
           || $('a[href*="/download"]').first().attr('href');

  if (!dlUrl) throw new Error('Download link not found on page');
  if (!dlUrl.startsWith('http')) dlUrl = `https://apkpure.com${dlUrl}`;

  // Follow to actual APK link
  const dlPage = await axios.get(dlUrl, { headers: HEADERS, timeout: 15000, maxRedirects: 5 });
  const $2 = cheerio.load(dlPage.data);

  let apkLink = $2('a#download_link, a.download-btn, a[href$=".apk"]').attr('href')
             || $2('a[href*="download.apkpure.com"]').first().attr('href');

  // If still not found, check for redirect URL in meta
  if (!apkLink) {
    const metaRefresh = $2('meta[http-equiv="refresh"]').attr('content');
    if (metaRefresh) {
      const match = metaRefresh.match(/url=(.+)/i);
      if (match) apkLink = match[1];
    }
  }

  if (!apkLink) throw new Error('Could not resolve APK download URL');
  return apkLink;
}

// ── apk search ────────────────────────────────────────────────────────────────
cast({
  pattern:  'apk',
  alias:    ['apkdl', 'apkdown'],
  desc:     'Search and download APK from APKPure',
  category: 'downloader',
  use:      '<app name>',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply }) => {
  if (!q) return reply(
    `📦 *APK Downloader*\n\n` +
    `Usage: apk <app name>\n` +
    `Example: apk WhatsApp\n` +
    `Example: apk Spotify\n\n` +
    `_Searches APKPure for the latest APK_`
  );

  await reply(`🔍 Searching for *${q}*...`);

  try {
    // Search for app
    const results = await searchApk(q);
    if (!results.length) return reply(`❌ No results found for *${q}*\nTry a different name.`);

    const app = results[0];
    await reply(`📦 Found: *${app.name}*\n⏳ Getting download link...`);

    // Get download link
    const apkUrl = await getApkDownloadLink(app.href);

    await reply(`⬇️ Downloading APK...`);

    // Download the APK
    const response = await axios.get(apkUrl, {
      responseType: 'arraybuffer',
      headers: HEADERS,
      timeout: 120000,
      maxContentLength: 100 * 1024 * 1024, // 100MB max
      onDownloadProgress: () => {},
    });

    const buffer   = Buffer.from(response.data);
    const sizeMB   = (buffer.length / 1024 / 1024).toFixed(2);
    const fileName = `${app.name.replace(/[^a-z0-9]/gi,'_')}.apk`;

    await conn.sendMessage(from, {
      document: buffer,
      mimetype: 'application/vnd.android.package-archive',
      fileName,
      caption:
        `📦 *${app.name}*\n` +
        `${app.version ? `🏷️ Version: ${app.version}\n` : ''}` +
        `📁 Size: ${sizeMB} MB\n` +
        `🔗 Source: APKPure`,
    }, { quoted: mek });

  } catch (e) {
    console.error('[apk]', e.message);
    return reply(
      `❌ Could not download APK.\n\n` +
      `Reason: ${e.message}\n\n` +
      `Try searching on APKPure directly:\n` +
      `https://apkpure.com/search?q=${encodeURIComponent(q)}`
    );
  }
});

// ── apksearch — show top 5 results ───────────────────────────────────────────
cast({
  pattern:  'apksearch',
  alias:    ['searchapk'],
  desc:     'Search APK and show top 5 results',
  category: 'downloader',
  use:      '<app name>',
  filename: __filename,
}, async (conn, mek, m, { from, q, reply }) => {
  if (!q) return reply('Usage: apksearch <app name>');
  await reply(`🔍 Searching for *${q}*...`);

  try {
    const results = await searchApk(q);
    if (!results.length) return reply(`❌ No results found for *${q}*`);

    const lines = results.map((r, i) =>
      `${i+1}. *${r.name}*${r.version ? ` (${r.version})` : ''}\n   ${r.href}`
    );

    return reply(
      `📦 *APK Search Results for "${q}"*\n\n` +
      lines.join('\n\n') +
      `\n\n_Use: apk <name> to download_`
    );
  } catch (e) {
    return reply(`❌ Search failed: ${e.message}`);
  }
});

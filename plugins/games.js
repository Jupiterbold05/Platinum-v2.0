'use strict';

const { cast, makeSmartQuote, applyFont } = require('../cast');
const config = require('../config');
const botdb = require('../lib/botdb');
const axios = require('axios');

const fetch  = require('node-fetch');

// ── CLASSIC GAMES — guessage/guesscountry/numguess/dice/gtc/cfg/co/hcg 
// Commands: guessage, guesscountry, guessgender, guess, cfg, delcfg,
//           co (capital), hcg, delhcg, dice, gtc
// SKIPPED: ttt/delttt (exists), wcg/delwcg (exists)
//
// IMPORTANT: Add this to index.js message handler (same place as checkAfkMention etc.):
//   const { handleGameText } = require('./plugins/games');
//   await handleGameText(conn, mek, m, { from, sender, body });

// ══════════════════════════════════════════════════════════════════════════════
// NAME GUESSING COMMANDS  (agify / nationalize / genderize — all free, no key)
// ══════════════════════════════════════════════════════════════════════════════

cast({
  pattern:  'guessage',
  alias:    ['ageguess'],
  desc:     'Guess the age of a person based on their name',
  category: 'game',
  use:      '<name>',
  filename: __filename,
}, async (conn, mek, m, { q, reply }) => {
  try {
    if (!q) return reply('*Provide a name!*\nExample: :guessage John');
    const { data } = await axios.get(`https://api.agify.io/?name=${encodeURIComponent(q.trim())}`);
    reply(
      `*🔢 Age Guesser*\n\n` +
      `*Name:* ${data.name}\n` +
      `*Estimated Age:* ${data.age ?? 'Unknown'}\n` +
      `*Data Count:* ${data.count}`
    );
  } catch (e) { reply('Error: ' + e.message); }
});

cast({
  pattern:  'guesscountry',
  alias:    ['namecountry'],
  desc:     'Guess the likely countries associated with a name',
  category: 'game',
  use:      '<name>',
  filename: __filename,
}, async (conn, mek, m, { q, reply }) => {
  try {
    if (!q) return reply('*Provide a name!*\nExample: :guesscountry Fatima');
    const { data } = await axios.get(`https://api.nationalize.io/?name=${encodeURIComponent(q.trim())}`);
    let out = `*🌍 Country Guesser*\n\n*Name:* ${data.name}\n*Count:* ${data.count}\n*Likely Countries:*\n`;
    (data.country || []).forEach((c, i) => {
      out += `\n${i + 1}. ${c.country_id} (${(c.probability * 100).toFixed(1)}%)`;
    });
    reply(out);
  } catch (e) { reply('Error: ' + e.message); }
});

cast({
  pattern:  'guessgender',
  alias:    ['namegender'],
  desc:     'Guess the gender of a person based on their name',
  category: 'game',
  use:      '<name>',
  filename: __filename,
}, async (conn, mek, m, { q, reply }) => {
  try {
    if (!q) return reply('*Provide a name!*\nExample: :guessgender Sarah');
    const { data } = await axios.get(`https://api.genderize.io/?name=${encodeURIComponent(q.trim())}`);
    reply(
      `*⚥ Gender Guesser*\n\n` +
      `*Name:* ${data.name}\n` +
      `*Gender:* ${data.gender ?? 'Unknown'}\n` +
      `*Probability:* ${((data.probability ?? 0) * 100).toFixed(1)}%\n` +
      `*Count:* ${data.count}`
    );
  } catch (e) { reply('Error: ' + e.message); }
});

// ══════════════════════════════════════════════════════════════════════════════
// NUMBER GUESSING GAME
// ══════════════════════════════════════════════════════════════════════════════

const numGuessGames = {}; // { [jid]: { player, randomNumber, mode, attempts, status } }

const NUMGUESS_LOGO = `█▄ █ █   █  █▄ ▄█  ██▄ ██▀ █▀▄\n█ ▀█ █▄█  █  ▀  █  █▄█ █▄▄ █▀▄`;

cast({
  pattern:  'numguess',
  alias:    ['nguess', 'guessnumber'],
  desc:     'Play a number guessing game',
  category: 'game',
  use:      '<easy | medium | hard | end>',
  filename: __filename,
}, async (conn, mek, m, { from, sender, q, reply }) => {
  try {
    const input    = (q || '').toLowerCase().trim();
    const existing = numGuessGames[from];

    if (input === 'end') {
      if (!existing) return reply('*No game is running in this chat.*');
      const canEnd = existing.player === sender || m.isOwner;
      if (!canEnd) return reply("*You're not the player of the running game!*");
      delete numGuessGames[from];
      return reply('*Number Guessing Game ended. Goodbye!*');
    }

    if (existing?.status) return reply('*A game is already in progress!*\nTo end: :numguess end');

    let max = 0, mode = '';
    if (input.includes('easy'))   { max = 100;   mode = 'Easy';   }
    else if (input.includes('medium')) { max = 1000;  mode = 'Medium'; }
    else if (input.includes('hard'))   { max = 10000; mode = 'Hard';   }
    else return reply(
      NUMGUESS_LOGO + '\n   𝗡𝘂𝗺𝗯𝗲𝗿 𝗚𝘂𝗲𝘀𝘀𝗶𝗻𝗴 𝗚𝗮𝗺𝗲 𝗠𝗲𝗻𝘂\n\n' +
      '*Choose a mode:*\n  ▢ Easy   (0–100)\n  ▢ Medium (0–1000)\n  ▢ Hard   (0–10000)\n  ▢ End    (end game)'
    );

    numGuessGames[from] = { player: sender, randomNumber: Math.floor(Math.random() * max), mode, attempts: 0, status: true };

    reply(
      NUMGUESS_LOGO + '\n  𝗡𝘂𝗺𝗯𝗲𝗿 𝗚𝘂𝗲𝘀𝘀𝗶𝗻𝗴 𝗚𝗮𝗺𝗲 𝗦𝘁𝗮𝗿𝘁𝗲𝗱\n\n' +
      `*Mode:* ${mode}\n` +
      `*Range:* 0 – ${max}\n\n` +
      `_I'm thinking of a number… guess it!_`
    );
  } catch (e) { reply('Error: ' + e.message); }
});

// ══════════════════════════════════════════════════════════════════════════════
// CONNECT FOUR GAME
// ══════════════════════════════════════════════════════════════════════════════

const cfgGames = {}; // { [jid]: ConnectFourGame }
const CFG_QUOTES = [
  "Connect Four: Where strategy meets fun!",
  "Let the battle of four-in-a-row begin!",
  "Connect Four: A game of wits and tactics.",
  "Four in a row, that's the way to go!",
  "Every move counts — think before you drop!",
];

class ConnectFourGame {
  constructor() {
    this.player1 = ''; this.player2 = ''; this.currentPlayer = '';
    this.gameStatus = false; this.attempts = {};
    this.matrix = Array.from({ length: 6 }, () => Array(7).fill('⚪'));
  }
  async drop(col) {
    const disc = this.currentPlayer === this.player1 ? '🔵' : '🔴';
    for (let r = 5; r >= 0; r--) {
      if (this.matrix[r][col] === '⚪') { this.matrix[r][col] = disc; return true; }
    }
    return false;
  }
  printMatrix() {
    return this.matrix.map(row => '| ' + row.join(' | ') + ' |').join('\n');
  }
  checkWin() {
    const disc = this.currentPlayer === this.player1 ? '🔵' : '🔴';
    const m = this.matrix;
    for (let r = 0; r < 6; r++)
      for (let c = 0; c <= 3; c++)
        if ([0,1,2,3].every(i => m[r][c+i] === disc)) return true;
    for (let r = 0; r <= 2; r++)
      for (let c = 0; c < 7; c++)
        if ([0,1,2,3].every(i => m[r+i][c] === disc)) return true;
    for (let r = 0; r <= 2; r++)
      for (let c = 0; c <= 3; c++)
        if ([0,1,2,3].every(i => m[r+i][c+i] === disc)) return true;
    for (let r = 0; r <= 2; r++)
      for (let c = 3; c < 7; c++)
        if ([0,1,2,3].every(i => m[r+i][c-i] === disc)) return true;
    return false;
  }
}

cast({
  pattern:  'cfg',
  desc:     'Start a Connect Four game session',
  category: 'game',
  use:      '<@mention or reply>',
  filename: __filename,
}, async (conn, mek, m, { from, sender, reply }) => {
  try {
    let game = cfgGames[from];
    if (game?.gameStatus) return conn.sendMessage(from, {
      text: `*A game is already in progress!*\nPlayers: @${game.player1.split('@')[0]} vs @${game.player2.split('@')[0]}\nTo end: :delcfg`,
      mentions: [game.player1, game.player2]
    }, { quoted: mek });

    if (!game) { game = new ConnectFourGame(); cfgGames[from] = game; }

    const ctx      = mek.message?.extendedTextMessage?.contextInfo;
    const mentioned = ctx?.mentionedJid?.[0] || (ctx?.participant !== sender ? ctx?.participant : null);
    const opponent  = mentioned && mentioned !== sender ? mentioned : null;

    if (opponent) {
      game.player1 = sender; game.player2 = opponent; game.gameStatus = true;
    } else if (!game.player1 || game.player1 === sender) {
      game.player1 = sender;
      return conn.sendMessage(from, {
        text: `▄▀▀ ▄▀▄ █▄ █ █▄ █ ▄▀▀ ▀█▀\n▀▄▄ ▀▄▀ █ ▀█ █ ▀█ ▀▄▄    █\n   𝗖𝗼𝗻𝗻𝗲𝗰𝘁 𝗙𝗼𝘂𝗿 𝗚𝗮𝗺𝗲 𝗦𝗲𝘀𝘀𝗶𝗼𝗻\n\n*Session Created!*\n_Player 1: @${sender.split('@')[0]} joined_\n_Waiting for another player..._\n\nType :cfg to join.`,
        mentions: [sender]
      }, { quoted: mek });
    } else if (sender !== game.player1) {
      game.player2 = sender; game.gameStatus = true;
    }

    if (game.gameStatus) {
      game.currentPlayer = game.player1;
      game.attempts[game.player1] = 0; game.attempts[game.player2] = 0;
      await conn.sendMessage(from, {
        text: `▄▀▀ ▄▀▄ █▄ █ █▄ █ ▄▀▀ ▀█▀\n▀▄▄ ▀▄▀ █ ▀█ █ ▀█ ▀▄▄    █\n   𝗖𝗼𝗻𝗻𝗲𝗰𝘁 𝗙𝗼𝘂𝗿 𝗚𝗮𝗺𝗲 𝗦𝘁𝗮𝗿𝘁𝗲𝗱\n\n${game.printMatrix()}\n\n` +
          `*Current Turn 🔵:* @${game.player1.split('@')[0]}\n*Next Turn 🔴:* @${game.player2.split('@')[0]}\n\n` +
          `▢ _Enter a column number 1–7_\n\n_"${CFG_QUOTES[Math.floor(Math.random() * CFG_QUOTES.length)]}"_`,
        mentions: [game.player1, game.player2]
      }, { quoted: mek });
    }
  } catch (e) { reply('Error: ' + e.message); }
});

cast({
  pattern:  'delcfg',
  desc:     'Delete a running Connect Four session',
  category: 'game',
  filename: __filename,
}, async (conn, mek, m, { from, sender, isOwner, reply }) => {
  const game = cfgGames[from];
  if (!game) return reply('*No Connect Four game running in this chat.*');
  if (!isOwner && sender !== game.player1 && sender !== game.player2)
    return reply("*You're not a player of the running game!*");
  delete cfgGames[from];
  reply('*Connect Four session ended.*');
});

// ══════════════════════════════════════════════════════════════════════════════
// CAPITAL CITY QUIZ
// ══════════════════════════════════════════════════════════════════════════════

const CAPITALS = { Afghanistan:"Kabul",Albania:"Tirana",Algeria:"Algiers",Angola:"Luanda",Argentina:"Buenos Aires",Armenia:"Yerevan",Australia:"Canberra",Austria:"Vienna",Azerbaijan:"Baku",Bahamas:"Nassau",Bahrain:"Manama",Bangladesh:"Dhaka",Belarus:"Minsk",Belgium:"Brussels",Bolivia:"Sucre",Brazil:"Brasília",Bulgaria:"Sofia",Cambodia:"Phnom Penh",Cameroon:"Yaoundé",Canada:"Ottawa",Chad:"N'Djamena",Chile:"Santiago",China:"Beijing",Colombia:"Bogotá",Croatia:"Zagreb",Cuba:"Havana",Cyprus:"Nicosia","Czech Republic":"Prague",Denmark:"Copenhagen",Ecuador:"Quito",Egypt:"Cairo",Ethiopia:"Addis Ababa",Finland:"Helsinki",France:"Paris",Germany:"Berlin",Ghana:"Accra",Greece:"Athens",Hungary:"Budapest",Iceland:"Reykjavik",India:"New Delhi",Indonesia:"Jakarta",Iran:"Tehran",Iraq:"Baghdad",Ireland:"Dublin",Israel:"Jerusalem",Italy:"Rome",Jamaica:"Kingston",Japan:"Tokyo",Jordan:"Amman",Kenya:"Nairobi","Korea, South":"Seoul",Kuwait:"Kuwait",Latvia:"Riga",Lebanon:"Beirut",Libya:"Tripoli",Malaysia:"Kuala Lumpur",Mexico:"Mexico City",Morocco:"Rabat",Mozambique:"Maputo",Myanmar:"Naypyidaw",Nepal:"Kathmandu",Netherlands:"Amsterdam","New Zealand":"Wellington",Nigeria:"Abuja",Norway:"Oslo",Pakistan:"Islamabad",Palestine:"Ramallah",Peru:"Lima",Philippines:"Manila",Poland:"Warsaw",Portugal:"Lisbon",Qatar:"Doha",Romania:"Bucharest",Russia:"Moscow",Rwanda:"Kigali","Saudi Arabia":"Riyadh",Senegal:"Dakar",Serbia:"Belgrade",Singapore:"Singapore",Somalia:"Mogadishu","South Africa":"Pretoria","South Sudan":"Juba",Spain:"Madrid","Sri Lanka":"Colombo",Sudan:"Khartoum",Sweden:"Stockholm",Switzerland:"Bern",Syria:"Damascus",Taiwan:"Taipei",Tanzania:"Dodoma",Thailand:"Bangkok",Tunisia:"Tunis",Turkey:"Ankara",Uganda:"Kampala",Ukraine:"Kyiv","United Arab Emirates":"Abu Dhabi","United Kingdom":"London","United States":"Washington",Venezuela:"Caracas",Vietnam:"Hanoi",Yemen:"Sana",Zambia:"Lusaka",Zimbabwe:"Harare" };

const capitalGames = {}; // { [sender]: { id, country, capital, attempts, timer } }

cast({
  pattern:  'co',
  alias:    ['capital', 'capitalquiz'],
  desc:     'Guess the capital city of a country',
  category: 'game',
  filename: __filename,
}, async (conn, mek, m, { from, sender, reply }) => {
  try {
    if (capitalGames[sender]) return reply('*You already have a game running! Answer it first.*');
    const keys    = Object.keys(CAPITALS);
    const country = keys[Math.floor(Math.random() * keys.length)];
    const capital = CAPITALS[country];

    const game = { id: from, country, capital, attempts: 0, prevText: '', timer: null };
    capitalGames[sender] = game;

    await conn.sendMessage(from, {
      text: `*🌍 Capital City Quiz*\n\n*Player:* @${sender.split('@')[0]}\n*Question:* What is the capital of *${country}*?\n\n_You have 30 seconds to answer!_`,
      mentions: [sender]
    }, { quoted: mek });

    game.timer = setTimeout(async () => {
      if (!capitalGames[sender]) return;
      delete capitalGames[sender];
      await conn.sendMessage(from, {
        text: `*⏰ Time's up, @${sender.split('@')[0]}!*\nThe capital of *${country}* is *${capital}*.`,
        mentions: [sender]
      }, { quoted: mek });
    }, 30000);
  } catch (e) { reply('Error: ' + e.message); }
});

// ══════════════════════════════════════════════════════════════════════════════
// HIDDEN CARD GAME
// ══════════════════════════════════════════════════════════════════════════════

const hcgGames = {}; // { [jid]: HiddenCardGame }

class HiddenCardGame {
  constructor(size = 5) {
    this.size = Math.min(Math.max(size, 3), 7);
    this.total = this.size * this.size;
    this.player1 = ''; this.player2 = ''; this.currentPlayer = '';
    this.gameStatus = false; this.attempts = {};
    this.board = Array(this.total).fill('🈲');
    this.hiddenIdx = -1;
  }
  start(p1, p2) {
    this.player1 = p1; this.player2 = p2;
    this.currentPlayer = p1;
    this.attempts[p1] = 0; this.attempts[p2] = 0;
    this.hiddenIdx = Math.floor(Math.random() * this.total);
    this.gameStatus = true;
  }
  move(player, num) {
    if (player !== this.currentPlayer) return { err: "*It's not your turn!*" };
    const idx = num - 1;
    if (idx < 0 || idx >= this.total || this.board[idx] !== '🈲')
      return { err: `*Invalid move! Enter 1–${this.total}*` };
    this.attempts[player]++;
    if (idx === this.hiddenIdx) {
      this.board[idx] = '🃏'; this.gameStatus = false;
      return { win: true };
    }
    this.board[idx] = '🟦';
    if (!this.board.includes('🈲')) { this.gameStatus = false; return { draw: true }; }
    this.currentPlayer = player === this.player1 ? this.player2 : this.player1;
    return { ok: true };
  }
  display() {
    let out = '';
    for (let r = 0; r < this.size; r++) {
      out += this.board.slice(r * this.size, r * this.size + this.size).join(' ') + '\n';
    }
    return out.trim();
  }
}

cast({
  pattern:  'hcg',
  desc:     'Start a Hidden Card Game (find the queen card)',
  category: 'game',
  use:      '<@mention> [grid size 3-7]',
  filename: __filename,
}, async (conn, mek, m, { from, sender, args, reply }) => {
  try {
    let game = hcgGames[from];
    if (game?.gameStatus) return reply('*A game is already in progress!*');

    const ctx      = mek.message?.extendedTextMessage?.contextInfo;
    const mentioned = ctx?.mentionedJid?.[0] || (ctx?.participant !== sender ? ctx?.participant : null);
    const opponent  = mentioned && mentioned !== sender ? mentioned : null;
    const size      = parseInt(args[0]) || 5;

    if (!game) { game = new HiddenCardGame(size); hcgGames[from] = game; }

    if (opponent) {
      game.start(sender, opponent);
    } else if (!game.player1 || game.player1 === sender) {
      game.player1 = sender;
      return conn.sendMessage(from, {
        text: `┏━━━━━━━━━━━━━━━━━━┓\n┃   HIDDEN CARD GAME   ┃\n┗━━━━━━━━━━━━━━━━━━┛\n\n*Session Created!*\n_@${sender.split('@')[0]} joined_\n_Waiting for another player..._\n\nType :hcg to join.`,
        mentions: [sender]
      }, { quoted: mek });
    } else if (sender !== game.player1) {
      game.start(game.player1, sender);
    }

    if (game.gameStatus) {
      await conn.sendMessage(from, {
        text: `┏━━━━━━━━━━━━━━━━━━┓\n┃   HIDDEN CARD GAME   ┃\n┗━━━━━━━━━━━━━━━━━━┛\n\n*Game started!*\n_Grid: ${game.size}×${game.size} (${game.total} cells)_\n_Find the hidden queen card 🃏_\n\n${game.display()}\n\n*Current Turn:* @${game.currentPlayer.split('@')[0]}\n_Enter a number 1–${game.total}_`,
        mentions: [game.player1, game.player2]
      }, { quoted: mek });
    }
  } catch (e) { reply('Error: ' + e.message); }
});

cast({
  pattern:  'delhcg',
  desc:     'Delete a running Hidden Card Game session',
  category: 'game',
  filename: __filename,
}, async (conn, mek, m, { from, sender, isOwner, reply }) => {
  const game = hcgGames[from];
  if (!game) return reply('*No Hidden Card Game running in this chat.*');
  if (!isOwner && sender !== game.player1 && sender !== game.player2)
    return reply("*You're not a player of the running game!*");
  delete hcgGames[from];
  reply('*Hidden Card Game session deleted.*');
});

// ══════════════════════════════════════════════════════════════════════════════
// DICE
// ══════════════════════════════════════════════════════════════════════════════

const DICE_STICKERS = [
  'https://raw.githubusercontent.com/SuhailTechInfo/Suhail-Md-Media/main/ᴅɪᴄᴇ/sᴜʜᴀɪʟ-ᴍᴅ-ᴅɪᴄᴇ-1.webp',
  'https://raw.githubusercontent.com/SuhailTechInfo/Suhail-Md-Media/main/ᴅɪᴄᴇ/sᴜʜᴀɪʟ-ᴍᴅ-ᴅɪᴄᴇ-2.webp',
  'https://raw.githubusercontent.com/SuhailTechInfo/Suhail-Md-Media/main/ᴅɪᴄᴇ/sᴜʜᴀɪʟ-ᴍᴅ-ᴅɪᴄᴇ-3.webp',
  'https://raw.githubusercontent.com/SuhailTechInfo/Suhail-Md-Media/main/ᴅɪᴄᴇ/sᴜʜᴀɪʟ-ᴍᴅ-ᴅɪᴄᴇ-4.webp',
  'https://raw.githubusercontent.com/SuhailTechInfo/Suhail-Md-Media/main/ᴅɪᴄᴇ/sᴜʜᴀɪʟ-ᴍᴅ-ᴅɪᴄᴇ-5.webp',
  'https://raw.githubusercontent.com/SuhailTechInfo/Suhail-Md-Media/main/ᴅɪᴄᴇ/sᴜʜᴀɪʟ-ᴍᴅ-ᴅɪᴄᴇ-6.webp',
];

cast({
  pattern:  'dice',
  desc:     'Roll a dice',
  category: 'game',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  try {
    const idx = Math.floor(Math.random() * 6);
    try {
      await conn.sendMessage(from, { sticker: { url: DICE_STICKERS[idx] } }, { quoted: mek });
    } catch {
      // fallback to emoji
      const emojis = ['⚀','⚁','⚂','⚃','⚄','⚅'];
      await conn.sendMessage(from, { text: emojis[idx] }, { quoted: mek });
    }
  } catch (e) { reply('Error: ' + e.message); }
});

// ══════════════════════════════════════════════════════════════════════════════
// GTC — Guess The (Anime) Character
// ══════════════════════════════════════════════════════════════════════════════

const gtcGames = {}; // { [msgId]: { ans, emoji, emojies } }
const GTC_SETS  = [['😺','👻','⏳','🍫'],['🥳','🍂','😎','💀'],['💍','🍁','🔥','💥'],['✨','❄️','⭐','🌚']];

cast({
  pattern:  'gtc',
  alias:    ['animeguess', 'guessanime'],
  desc:     'Guess the anime character name',
  category: 'game',
  use:      '(no args)',
  filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
  try {
    const randomChar = require('anime-character-random');
    const char  = await randomChar.GetChar();
    const opts  = [char.OtherCharacterList[0], char.OtherCharacterList[1], char.OtherCharacterList[2], char.CharacterName]
                    .sort(() => Math.random() - 0.5);
    const ansIdx = opts.indexOf(char.CharacterName);
    const emojis = GTC_SETS.map(s => s[Math.floor(Math.random() * s.length)]);

    const text =
      `*[GUESS THE ANIME CHARACTER]*\n\n_React or reply with the correct emoji!_\n\n` +
      opts.map((o, i) => `${emojis[i]}) ${o}`).join('\n') +
      `\n\n_Powered by NEXUS-MD_`;

    const sent = await conn.sendMessage(from, { image: { url: char.CharacterImage }, caption: text }, { quoted: mek });
    const msgId = sent?.key?.id;
    if (msgId) {
      gtcGames[msgId] = { ans: char.CharacterName, emoji: emojis[ansIdx], emojies: emojis };
      setTimeout(() => { delete gtcGames[msgId]; }, 5 * 60 * 1000); // expire after 5 min
    }
  } catch (e) { reply('Error: ' + e.message); }
});

// ══════════════════════════════════════════════════════════════════════════════
// TEXT LISTENER — handles all game moves
// Call this from index.js in the message handler:
//   const { handleGameText } = require('./plugins/games');
//   await handleGameText(conn, mek, m, { from, sender, body });
// ══════════════════════════════════════════════════════════════════════════════

async function handleGameText(conn, mek, m, { from, sender, body }) {
  if (!body || mek.key?.fromMe) return;

  // ── Number Guessing ────────────────────────────────────────────────────────
  try {
    const ng = numGuessGames[from];
    if (ng?.status && ng.player === sender) {
      const guess = parseInt(body.trim().split(' ')[0]);
      if (!isNaN(guess)) {
        ng.attempts++;
        if (guess < ng.randomNumber) {
          await conn.sendMessage(from, {
            text: `${NUMGUESS_LOGO}\n  𝗧𝗼𝗼 𝗟𝗼𝘄!\n\n*Attempts:* ${ng.attempts}\n_Try a higher number than ${guess}._`,
          }, { quoted: mek });
        } else if (guess > ng.randomNumber) {
          await conn.sendMessage(from, {
            text: `${NUMGUESS_LOGO}\n  𝗧𝗼𝗼 𝗛𝗶𝗴𝗵!\n\n*Attempts:* ${ng.attempts}\n_Try a lower number than ${guess}._`,
          }, { quoted: mek });
        } else {
          delete numGuessGames[from];
          await conn.sendMessage(from, {
            text: `${NUMGUESS_LOGO}\n  𝗚𝗮𝗺𝗲 𝗙𝗶𝗻𝗶𝘀𝗵𝗲𝗱! 🎉\n\n*Correct! The number was ${ng.randomNumber}*\n*Attempts:* ${ng.attempts}\n*Mode:* ${ng.mode}`,
            mentions: [sender]
          }, { quoted: mek });
        }
      }
    }
  } catch {}

  // ── Connect Four ───────────────────────────────────────────────────────────
  try {
    const cfg = cfgGames[from];
    if (cfg?.gameStatus && cfg.currentPlayer === sender) {
      const col = parseInt(body.trim()) - 1;
      if (!isNaN(col) && col >= 0 && col < 7) {
        const dropped = await cfg.drop(col);
        if (!dropped) {
          return conn.sendMessage(from, { text: `*Column ${col + 1} is full! Choose another.*`, mentions: [sender] }, { quoted: mek });
        }
        cfg.attempts[sender]++;
        const won = cfg.checkWin();
        const board = cfg.printMatrix();
        if (won) {
          const loser = sender === cfg.player1 ? cfg.player2 : cfg.player1;
          delete cfgGames[from];
          return conn.sendMessage(from, {
            text: `▄▀▀ ▄▀▄ █▄ █ █▄ █ ▄▀▀ ▀█▀\n▀▄▄ ▀▄▀ █ ▀█ █ ▀█ ▀▄▄    █\n   𝗚𝗮𝗺𝗲 𝗙𝗶𝗻𝗶𝘀𝗵𝗲𝗱!\n\n${board}\n\n*🏆 Winner:* @${sender.split('@')[0]}\n*💀 Loser:* @${loser.split('@')[0]}\n_Congratulations!_`,
            mentions: [sender, loser]
          }, { quoted: mek });
        }
        cfg.currentPlayer = sender === cfg.player1 ? cfg.player2 : cfg.player1;
        await conn.sendMessage(from, {
          text: `▄▀▀ ▄▀▄ █▄ █ █▄ █ ▄▀▀ ▀█▀\n▀▄▄ ▀▄▀ █ ▀█ █ ▀█ ▀▄▄    █\n   𝗖𝗼𝗻𝗻𝗲𝗰𝘁 𝗙𝗼𝘂𝗿 𝗕𝗼𝗮𝗿𝗱\n\n${board}\n\n` +
            `*Current Turn ${cfg.currentPlayer === cfg.player1 ? '🔵' : '🔴'}:* @${cfg.currentPlayer.split('@')[0]}\n_Enter column 1–7_`,
          mentions: [cfg.player1, cfg.player2]
        }, { quoted: mek });
      }
    }
  } catch {}

  // ── Capital Quiz ───────────────────────────────────────────────────────────
  try {
    const cg = capitalGames[sender];
    if (cg && cg.id === from && body.trim() !== cg.prevText) {
      cg.prevText = body.trim();
      cg.attempts++;
      clearTimeout(cg.timer);
      if (body.trim().toLowerCase() === cg.capital.toLowerCase()) {
        delete capitalGames[sender];
        await conn.sendMessage(from, {
          text: `*✅ Correct, @${sender.split('@')[0]}!*\n_The capital of *${cg.country}* is *${cg.capital}*._\n*Attempts:* ${cg.attempts}`,
          mentions: [sender]
        }, { quoted: mek });
      } else if (cg.attempts >= 3) {
        delete capitalGames[sender];
        await conn.sendMessage(from, {
          text: `*❌ Game Over, @${sender.split('@')[0]}!*\n_Too many wrong answers._\nThe capital of *${cg.country}* is *${cg.capital}*.`,
          mentions: [sender]
        }, { quoted: mek });
      } else {
        await conn.sendMessage(from, {
          text: `*Wrong! @${sender.split('@')[0]}*\n_${3 - cg.attempts} attempt(s) left. You have 30s._`,
          mentions: [sender]
        }, { quoted: mek });
        cg.timer = setTimeout(async () => {
          if (!capitalGames[sender]) return;
          delete capitalGames[sender];
          await conn.sendMessage(from, {
            text: `*⏰ Time's up, @${sender.split('@')[0]}!*\nThe capital of *${cg.country}* is *${cg.capital}*.`,
            mentions: [sender]
          }, { quoted: mek });
        }, 30000);
      }
    }
  } catch {}

  // ── Hidden Card Game ───────────────────────────────────────────────────────
  try {
    const hcg = hcgGames[from];
    if (hcg?.gameStatus && hcg.currentPlayer === sender) {
      const num = parseInt(body.trim());
      if (!isNaN(num)) {
        const result = hcg.move(sender, num);
        if (result.err) return conn.sendMessage(from, { text: result.err }, { quoted: mek });
        if (result.win) {
          const loser = sender === hcg.player1 ? hcg.player2 : hcg.player1;
          delete hcgGames[from];
          return conn.sendMessage(from, {
            text: `┏━━━━━━━━━━━━━━━━━━┓\n┃   𝗤𝗨𝗘𝗘𝗡 𝗖𝗔𝗥𝗗 𝗙𝗢𝗨𝗡𝗗!   ┃\n┗━━━━━━━━━━━━━━━━━━┛\n\n${hcg.display()}\n\n*🏆 Winner:* @${sender.split('@')[0]}\n*💀 Loser:* @${loser.split('@')[0]}\n_Found in ${hcg.attempts[sender]} attempt(s)!_`,
            mentions: [sender, loser]
          }, { quoted: mek });
        }
        if (result.draw) {
          delete hcgGames[from];
          return conn.sendMessage(from, { text: `*Game Over — hidden card not found!*\n${hcg.display()}` }, { quoted: mek });
        }
        await conn.sendMessage(from, {
          text: `┏━━━━━━━━━━━━━━━━━━┓\n┃   HIDDEN CARD GAME   ┃\n┗━━━━━━━━━━━━━━━━━━┛\n\n${hcg.display()}\n\n*Current Turn:* @${hcg.currentPlayer.split('@')[0]}\n_Enter 1–${hcg.total}_`,
          mentions: [hcg.player1, hcg.player2]
        }, { quoted: mek });
      }
    }
  } catch {}

  // ── GTC reaction/reply check ───────────────────────────────────────────────
  try {
    const reactionKey = mek.message?.reactionMessage?.key?.id;
    const replyKey    = mek.message?.extendedTextMessage?.contextInfo?.stanzaId;
    const msgId       = reactionKey || replyKey;
    const game        = msgId ? gtcGames[msgId] : null;
    if (game && body) {
      if (body === game.emoji) {
        delete gtcGames[msgId];
        await conn.sendMessage(from, {
          text: `*🎉 Correct, @${sender.split('@')[0]}!*\n_The character was: ${game.emoji}, { quoted: mek }) ${game.ans}_`,
          mentions: [sender]
        }, { quoted: mek });
      } else if (game.emojies.includes(body)) {
        if (!game[sender]) game[sender] = 0;
        game[sender]++;
        if (game[sender] >= 2) {
          delete gtcGames[msgId];
          await conn.sendMessage(from, {
            text: `*❌ You lose, @${sender.split('@')[0]}!*\nThe answer was: ${game.emoji}, { quoted: mek }) ${game.ans}`,
            mentions: [sender]
          }, { quoted: mek });
        } else {
          await conn.sendMessage(from, {
            text: `*Wrong! @${sender.split('@')[0]}*\n_One more chance!_`,
            mentions: [sender]
          }, { quoted: mek });
        }
      }
    }
  } catch {}
}



// ── TICTACTOE ─────────────────────────────────────────
// Tic Tac Toe plugin for WhatsApp bot (lobby, AI, timeouts, leaderboard)
//
// Usage (group):
//  - Start lobby (host):        !tictactoe
//  - Start vs AI (immediate):   !tictactoe ai
//  - Start with opponent:       !tictactoe @username
//  - Join lobby:                !join
//  - Start game (host):         !start
//  - Make move:                 !move 5    (1-9)
//  - Leave/cancel:              !leave / !cancel
//  - Show leaderboard:          !tttboard
//
// Works with your cast() loader. No DB required (leaderboard stored in ./data/ttt_leaderboard.json).

// Simple storage backed by botdb (replaces ttt_leaderboard.json)
function loadBoard() {
  const rows = botdb.getTTTLeaderboard(1000);
  const out = {};
  for (const r of rows) out[r.user_jid] = { wins: r.wins, losses: r.losses, draws: r.draws };
  return out;
}
function saveBoard(board) {
  for (const [uid, s] of Object.entries(board)) {
    if (!uid) continue;
    // Recalculate deltas by comparing to current stored stats
    const cur = botdb.getTTTStats(uid);
    botdb.db.prepare(`INSERT INTO ttt_leaderboard (user_jid,wins,losses,draws) VALUES (?,?,?,?)
      ON CONFLICT(user_jid) DO UPDATE SET wins=excluded.wins,losses=excluded.losses,draws=excluded.draws`)
      .run(uid, s.wins||0, s.losses||0, s.draws||0);
  }
}

// In-memory games store
const games = {};

// Defaults
const JOIN_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes to join
const MOVE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per move

// Helpers
const EMOJIS = {
  X: "❌",
  O: "⭕",
  1: "1️⃣",2: "2️⃣",3: "3️⃣",
  4: "4️⃣",5: "5️⃣",6: "6️⃣",
  7: "7️⃣",8: "8️⃣",9: "9️⃣"
};

function renderBoard(board) {
  let out = "";
  for (let i = 0; i < 9; i++) {
    out += EMOJIS[board[i]] || EMOJIS[i + 1];
    if ((i + 1) % 3 === 0) out += "\n";
  }
  return out;
}

function checkWinner(board) {
  const wins = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  for (const [a,b,c] of wins) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every(Boolean)) return "tie";
  return null;
}

// Minimax for unbeatable AI
function bestMoveMinimax(board, ai, human) {
  const winner = checkWinner(board);
  if (winner || board.every(Boolean)) return null;

  let bestScore = -Infinity, move = null;
  for (let i = 0; i < 9; i++) {
    if (!board[i]) {
      board[i] = ai;
      let score = minimax(board, 0, false, ai, human);
      board[i] = null;
      if (score > bestScore) {
        bestScore = score;
        move = i;
      }
    }
  }
  return move;
}
function minimax(board, depth, isMax, ai, human) {
  const winner = checkWinner(board);
  if (winner === ai) return 10 - depth;
  if (winner === human) return depth - 10;
  if (winner === "tie") return 0;

  if (isMax) {
    let best = -Infinity;
    for (let i = 0; i < 9; i++) {
      if (!board[i]) {
        board[i] = ai;
        best = Math.max(best, minimax(board, depth + 1, false, ai, human));
        board[i] = null;
      }
    }
    return best;
  } else {
    let best = Infinity;
    for (let i = 0; i < 9; i++) {
      if (!board[i]) {
        board[i] = human;
        best = Math.min(best, minimax(board, depth + 1, true, ai, human));
        board[i] = null;
      }
    }
    return best;
  }
}

// Game lifecycle helpers
function createLobby(from, hostJid, opts = {}) {
  const g = {
    createdAt: Date.now(),
    host: hostJid,
    board: Array(9).fill(null),
    players: {}, // X and O when assigned
    turn: "X",
    started: false,
    ai: !!opts.ai,
    joinTimer: null,
    moveTimer: null,
    pending: [] // list of JIDs waiting
  };
  games[from] = g;
  return g;
}
function clearGame(from) {
  const g = games[from];
  if (!g) return;
  if (g.joinTimer) clearTimeout(g.joinTimer);
  if (g.moveTimer) clearTimeout(g.moveTimer);
  delete games[from];
}
function startJoinTimeout(from, conn, reply) {
  const g = games[from];
  if (!g) return;
  if (g.joinTimer) clearTimeout(g.joinTimer);
  g.joinTimer = setTimeout(() => {
    reply("⏳ Lobby timed out due to inactivity. Cancelled.");
    clearGame(from);
  }, JOIN_TIMEOUT_MS);
}
function startMoveTimeout(from, conn, reply) {
  const g = games[from];
  if (!g) return;
  if (g.moveTimer) clearTimeout(g.moveTimer);
  g.moveTimer = setTimeout(() => {
    // opponent wins
    const loserTurn = g.turn;
    const winner = loserTurn === "X" ? "O" : "X";
    const winnerJid = g.players[winner];
    reply(`⏱️ Move timeout. ${EMOJIS[winner]} <@${(winnerJid||"unknown").split("@")[0]}> wins by timeout!\n\n` + renderBoard(g.board), { mentions: winnerJid ? [winnerJid] : [] });
    // update leaderboard
    const lb = loadBoard();
    if (winnerJid && winnerJid !== "AI") {
      lb[winnerJid] = (lb[winnerJid] || 0) + 1;
      saveBoard(lb);
    }
    clearGame(from);
  }, MOVE_TIMEOUT_MS);
}

// Normalize a jid or mention
function mentionName(jid) {
  if (!jid) return "unknown";
  return `@${jid.split("@")[0]}`;
}

// Command: create / quick start
cast({
  pattern: "tictactoe",
  desc: "Create TicTacToe lobby or play vs AI or start with a mentioned user",
  category: 'game',
  filename: __filename
}, async (conn, mek, m, { from, args, sender, reply, isGroup }) => {
  try {
    if (!isGroup) return reply("This command only works in groups.");

    // if a game already running
    if (games[from] && games[from].started) return reply("A game is already running in this group.");

    // If mention present => quick start vs mentioned
    const mentioned = (m.mentionedJid && m.mentionedJid.length) ? m.mentionedJid[0] : null;
    const arg0 = args && args[0] ? args[0].toLowerCase() : "";

    if (mentioned) {
      // start game immediate: sender X, mentioned O
      const g = createLobby(from, sender, { ai: false });
      g.players.X = sender;
      g.players.O = mentioned;
      g.started = true;
      // start move timeout
      startMoveTimeout(from, conn, reply);
      return reply(`🎮 Tic Tac Toe — Game started!\n\nPlayers:\nX: ${mentionName(g.players.X)}\nO: ${mentionName(g.players.O)}\n\n${renderBoard(g.board)}\nTurn: ${mentionName(g.players[g.turn])}`, { mentions: [g.players.X, g.players.O] });
    }

    if (arg0 === "ai") {
      // start vs AI immediately: player is X, AI is O
      const g = createLobby(from, sender, { ai: true });
      g.players.X = sender;
      g.players.O = "AI";
      g.started = true;
      // If AI goes first (we'll always start with X by default), so X is human
      startMoveTimeout(from, conn, reply);
      return reply(`🎮 Tic Tac Toe vs AI — Game started!\n\nYou: ${mentionName(g.players.X)} (❌)\nAI: ⭕\n\n${renderBoard(g.board)}\nTurn: ${mentionName(g.players[g.turn])}`, { mentions: [g.players.X] });
    }

    // otherwise create lobby waiting for join
    if (games[from]) {
      return reply("A lobby already exists. Type !join to join it or !cancel to cancel.");
    }
    const g = createLobby(from, sender, { ai: false });
    g.pending.push(sender);
    startJoinTimeout(from, conn, reply);
    return reply(`🎮 Tic Tac Toe lobby created by ${mentionName(sender)}.\nType !join to join the game. Host can type !start to begin or mention a user with !tictactoe @user to start immediately.\nLobby will auto-cancel after 2 minutes.`, { mentions: [sender] });
  } catch (e) {
    console.error("TTT.create error", e);
    reply("Error starting lobby.");
  }
});

// Command: join
cast({
  pattern: "ttt",
  desc: "Join a TicTacToe lobby",
  category: 'game',
  filename: __filename
}, async (conn, mek, m, { from, sender, reply, isGroup }) => {
  try {
    if (!isGroup) return reply("Use this in a group.");
    const g = games[from];
    if (!g) return reply("No active lobby in this group. Start with !tictactoe");

    if (g.started) return reply("Game already started.");
    // if already joined
    if (g.pending.includes(sender)) return reply("You already joined the lobby.");
    g.pending.push(sender);

    // If two distinct players -> assign and start
    // ensure unique participants
    const unique = [...new Set(g.pending)];
    if (unique.length >= 2) {
      // assign first two as X and O (host first)
      g.players.X = unique[0];
      g.players.O = unique[1];
      g.started = true;
      // clear join timer and start move timer
      if (g.joinTimer) clearTimeout(g.joinTimer);
      startMoveTimeout(from, conn, reply);
      return reply(`🎮 Tic Tac Toe — Game started!\n\nPlayers:\nX: ${mentionName(g.players.X)}\nO: ${mentionName(g.players.O)}\n\n${renderBoard(g.board)}\nTurn: ${mentionName(g.players[g.turn])}`, { mentions: [g.players.X, g.players.O] });
    } else {
      // still waiting
      startJoinTimeout(from, conn, reply);
      return reply(`${mentionName(sender)} joined the lobby. Waiting for one more player...`);
    }
  } catch (e) {
    console.error("TTT.join err", e);
    reply("Error joining lobby.");
  }
});

// Command: start (host forces start if two players pending)
cast({
  pattern: "start",
  desc: "Start the lobby (host)",
  category: 'game',
  filename: __filename
}, async (conn, mek, m, { from, sender, reply, isGroup }) => {
  try {
    if (!isGroup) return reply("Use this in a group.");
    const g = games[from];
    if (!g) return reply("No active lobby.");
    if (g.started) return reply("Game already started.");
    if (g.host !== sender) return reply("Only the host can start the game.");

    const unique = [...new Set(g.pending)];
    if (unique.length < 2) return reply("Need 2 players to start. Ask someone to !join.");

    g.players.X = unique[0];
    g.players.O = unique[1];
    g.started = true;
    if (g.joinTimer) clearTimeout(g.joinTimer);
    startMoveTimeout(from, conn, reply);
    return reply(`🎮 Tic Tac Toe — Game started by host!\n\nPlayers:\nX: ${mentionName(g.players.X)}\nO: ${mentionName(g.players.O)}\n\n${renderBoard(g.board)}\nTurn: ${mentionName(g.players[g.turn])}`, { mentions: [g.players.X, g.players.O] });
  } catch (e) {
    console.error("TTT.start err", e);
    reply("Error starting game.");
  }
});

// Command: leave (or resign)
cast({
  pattern: "leave|resign",
  desc: "Leave lobby or resign an ongoing game",
  category: 'game',
  filename: __filename
}, async (conn, mek, m, { from, sender, reply, isGroup }) => {
  try {
    if (!isGroup) return reply("Use this in a group.");
    const g = games[from];
    if (!g) return reply("Nothing to leave.");

    // If game not started, remove from pending
    if (!g.started) {
      g.pending = g.pending.filter(p => p !== sender);
      if (g.host === sender) {
        // host left -> cancel lobby
        clearGame(from);
        return reply("Host left. Lobby cancelled.");
      }
      return reply("You left the lobby.");
    }

    // If during game, resign -> opponent wins
    const playerSide = Object.keys(g.players).find(k => g.players[k] === sender);
    if (!playerSide) return reply("You're not a player in this game.");

    const winnerSide = playerSide === "X" ? "O" : "X";
    const winnerJid = g.players[winnerSide];
    reply(`⚠️ ${mentionName(sender)} resigned. ${EMOJIS[winnerSide]} ${mentionName(winnerJid)} wins!\n\n${renderBoard(g.board)}`, { mentions: winnerJid ? [winnerJid] : [] });

    // update leaderboard
    const lb = loadBoard();
    if (winnerJid && winnerJid !== "AI") {
      lb[winnerJid] = (lb[winnerJid] || 0) + 1;
      saveBoard(lb);
    }
    clearGame(from);
  } catch (e) {
    console.error("TTT.leave err", e);
    reply("Error leaving/resigning.");
  }
});

// Command: cancel (host or god)
cast({
  pattern: "cancel",
  desc: "Cancel the lobby or game (host or owner)",
  category: 'game',
  filename: __filename
}, async (conn, mek, m, { from, sender, reply, isGroup, isOwner, isAdmin }) => {
  try {
    if (!isGroup) return reply("Use this in a group.");
    const g = games[from];
    if (!g) return reply("No active lobby/game.");

    // allow host, owner (bot owner), or global god (if available)
    const godCheck = (typeof global.isGod === "function") ? global.isGod(sender.split("@")[0]) : false;
    if (g.host !== sender && !isOwner && !godCheck) return reply("Only the host or bot owner can cancel.");

    clearGame(from);
    return reply("Lobby/game cancelled by host/owner.");
  } catch (e) {
    console.error("TTT.cancel err", e);
    reply("Error cancelling.");
  }
});

// Command: move
cast({
  pattern: "move",
  desc: "Make a move (1-9)",
  category: 'game',
  filename: __filename
}, async (conn, mek, m, { from, args, sender, reply, isGroup, isOwner }) => {
  try {
    if (!isGroup) return reply("Use this in a group.");
    const g = games[from];
    if (!g || !g.started) return reply("No ongoing game in this group. Start with !tictactoe");

    // Validate numeric arg
    const pos = parseInt(args[0], 10);
    if (isNaN(pos) || pos < 1 || pos > 9) return reply("Choose a number from 1 to 9 for the cell.");

    // Check it's player's turn
    const side = Object.keys(g.players).find(k => g.players[k] === sender);
    if (!side) return reply("You're not a player in this game.");
    if (g.turn !== side) return reply("Not your turn.");

    const idx = pos - 1;
    if (g.board[idx]) return reply("That cell is already taken.");

    // Make move
    g.board[idx] = side;

    // Clear and restart move timer
    if (g.moveTimer) clearTimeout(g.moveTimer);

    // Check winner
    const winner = checkWinner(g.board);
    if (winner) {
      if (winner === "tie") {
        reply(`🤝 It's a tie!\n\n${renderBoard(g.board)}`);
      } else {
        const winnerJid = g.players[winner];
        reply(`🏆 Winner: ${EMOJIS[winner]} ${mentionName(winnerJid)}\n\n${renderBoard(g.board)}`, { mentions: winnerJid ? [winnerJid] : [] });

        // update leaderboard
        const lb = loadBoard();
        if (winnerJid && winnerJid !== "AI") {
          lb[winnerJid] = (lb[winnerJid] || 0) + 1;
          saveBoard(lb);
        }
      }
      clearGame(from);
      return;
    }

    // Switch turn
    g.turn = (g.turn === "X") ? "O" : "X";

    // AI move if applicable
    if (g.ai && g.players[g.turn] === "AI") {
      // AI's symbol
      const ai = "O";
      const human = "X";
      // Unbeatable move
      const aiMove = bestMoveMinimax(g.board.slice(), ai, human);
      if (aiMove !== null) g.board[aiMove] = ai;
      // Check after AI
      const winner2 = checkWinner(g.board);
      if (winner2) {
        if (winner2 === "tie") {
          reply(`🤝 It's a tie!\n\n${renderBoard(g.board)}`);
        } else {
          reply(`🏆 Winner: ${EMOJIS[winner2]} ${g.players[winner2] === "AI" ? "AI" : mentionName(g.players[winner2])}\n\n${renderBoard(g.board)}`);
          // update leaderboard (if human lost, AI not counted)
          const lb = loadBoard();
          const winnerJid = g.players[winner2];
          if (winnerJid && winnerJid !== "AI") {
            lb[winnerJid] = (lb[winnerJid] || 0) + 1;
            saveBoard(lb);
          }
        }
        clearGame(from);
        return;
      }
      // after AI move, set turn back to human
      g.turn = (g.turn === "X") ? "O" : "X";
    }

    // Restart move timer for the next player
    startMoveTimeout(from, conn, reply);

    // Reply with board and next turn
    const nextJid = g.players[g.turn];
    reply(`🎮 Tic Tac Toe\n\n${renderBoard(g.board)}\nTurn: ${mentionName(nextJid)}`, { mentions: nextJid && nextJid !== "AI" ? [nextJid] : [] });
  } catch (e) {
    console.error("TTT.move err", e);
    reply("Error processing move.");
  }
});

// Command: leaderboard
cast({
  pattern: "tttboard|leaderboard",
  desc: "Show TicTacToe leaderboard",
  category: 'game',
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  try {
    const lb = loadBoard();
    const entries = Object.entries(lb).sort((a,b) => b[1] - a[1]).slice(0,20);
    if (!entries.length) return reply("No leaderboard data yet.");
    let out = "🏆 Tic Tac Toe Leaderboard\n\n";
    for (let i=0;i<entries.length;i++){
      out += `${i+1}. ${mentionName(entries[i][0])} — ${entries[i][1]}\n`;
    }
    reply(out);
  } catch (e) {
    console.error("TTT.board err", e);
    reply("Error loading leaderboard.");
  }
});

// ── WORD CHAIN GAME ───────────────────────────────────
// Word Chain Game (WCG) plugin
// - lobby (start/join)
// - AI opponent
// - progressive length increase from 3 -> 15 over time
// - bot chooses starting letter each turn (not previous word's last letter)
// - spam detection (immediate repeat by same player) -> warns only
// - manual stop command (wcgstop)
// - end-of-game summary: winner's answered count, overall longest word, words count per player
// - preserves backward compatibility with previous behaviour where possible

const prefix = config.PREFIX || "/";

/* ---------------- botdb helpers (replaces JSON load/save) ---------------- */
function load(type) {
  if (type === 'db')    return botdb.db.prepare("SELECT group_jid,state FROM wcg_games").all().reduce((a,r)=>{try{a[r.group_jid]=JSON.parse(r.state);}catch(_){}return a;},{});
  if (type === 'stats') return botdb.db.prepare("SELECT user_jid,wins,losses,played FROM wcg_stats").all().reduce((a,r)=>{a[r.user_jid]={wins:r.wins,losses:r.losses,played:r.played};return a;},{});
  return {};
}
function loadGame(gid)        { return botdb.getWCGGame(gid) || {}; }
function saveGame(gid, state) { botdb.setWCGGame(gid, state); }
function deleteGame(gid)      { botdb.deleteWCGGame(gid); }
function loadStats()          { return load('stats'); }
function saveStats(stats) {
  for (const [uid, s] of Object.entries(stats)) {
    botdb.db.prepare(`INSERT INTO wcg_stats (user_jid,wins,losses,played) VALUES (?,?,?,?)
      ON CONFLICT(user_jid) DO UPDATE SET wins=excluded.wins,losses=excluded.losses,played=excluded.played`)
      .run(uid, s.wins||0, s.losses||0, s.played||0);
  }
}
function saveAllGames(db) {
  for (const [gid, state] of Object.entries(db)) {
    if (state) botdb.setWCGGame(gid, state);
    else botdb.deleteWCGGame(gid);
  }
}

const MAX_PLAYERS   = 20;
const JOIN_TIMEOUT  = 50000;
const TURN_TIMEOUT  = 30000;
const startTimers   = {};
const turnTimers    = {};
const aiThinkDelay  = 1200;
function clearTimer(timerMap, id) {
  if (timerMap[id]) {
    clearTimeout(timerMap[id]);
    delete timerMap[id];
  }
}

/* ---------------- dictionary & suggestion helpers ---------------- */
async function isValidWord(word) {
  try {
    const res = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    return Array.isArray(res.data) && res.data.length > 0;
  } catch {
    return false;
  }
}
async function getSuggestionStartsWith(letter, minLen) {
  try {
    // datamuse: words that start with letter
    const res = await axios.get(`https://api.datamuse.com/words?sp=${encodeURIComponent(letter)}*&max=40`);
    const suggestions = (res.data || []).map(x => x.word).filter(w => w.length >= minLen);
    for (let w of suggestions) {
      if (await isValidWord(w)) return w;
    }
    return null;
  } catch {
    return null;
  }
}

/* ---------------- game helpers ---------------- */
function getNextTurn(game) {
  return (game.turn + 1) % game.players.length;
}

// progressive minLen calculation based on game.level
// level 1 => minLen 3, level 2 => 4, ... cap at 15
function computeMinLen(level, base = 3) {
  const min = base + (level - 1);
  return Math.min(15, min);
}

// increase level after N accepted words to slowly make the game harder.
// we'll increment level every 4 accepted words by default.
const LEVEL_UP_THRESHOLD = 4;

function updateStats(player, win = false) {
  const stats = loadStats();
  if (!stats[player]) stats[player] = { wins: 0, losses: 0, played: 0 };
  stats[player].played++;
  if (win) stats[player].wins++;
  else stats[player].losses++;
  saveStats(stats);
}
function emojiRank(rank) {
  return ["🥇", "🥈", "🥉"][rank] || "🏅";
}

/* ---------------- turn flow ---------------- */

async function startGame(from, conn) {
  const db = load('db');
  const game = db[from];
  if (!game) return;

  game.waiting = false;
  game.turn = 0;
  game.level = game.level || 1; // progression level
  game.acceptedCount = game.acceptedCount || 0; // track accepted words to level up
  game.lastStartLetter = game.lastStartLetter || randomLetter(); // letter players must start with
  game.lastWord = ""; // last accepted word (for reference)
  game.words = game.words || []; // store all accepted words
  game.byPlayer = game.byPlayer || {}; // map player -> list of words they contributed
  game.wordCounts = game.wordCounts || {}; // counts per player

  // identify bot JID properly
  const botJid = conn?.user?.id ? (conn.user.id.split(":")[0] + "@s.whatsapp.net") : null;

  // AI enabled if only one player or if bot is present among players
  game.aiEnabled = (game.players.length === 1) || (botJid && game.players.includes(botJid) && game.players.length >= 1);

  // ensure bot not first when human exists
  if (botJid && game.players[0] === botJid && game.players.length > 1) {
    const idx = game.players.findIndex(p => p !== botJid);
    if (idx !== -1) [game.players[0], game.players[idx]] = [game.players[idx], game.players[0]];
  }

  saveAllGames(db);

  // announce
  const playersMention = game.players.map(p => "@" + p.split("@")[0]).join(", ");
  try {
    await conn.sendMessage(from, {
      text: `🎮 *Word Chain Game Started!* \nMode: *${(game.mode || "easy").toUpperCase()}*\nPlayers: ${playersMention}\n🎯 First Starter Letter: *${game.lastStartLetter.toUpperCase()}*\n🔢 Starting min length: ${computeMinLen(game.level)}\n\nFirst turn: @${game.players[0].split("@")[0]}`,
      mentions: game.players
    }, { quoted: mek });
  } catch (e) {
    try { await conn.sendMessage(from, { text: `Game started! Players: ${playersMention}` }, { quoted: mek }); } catch {}
  }

  beginTurn(from, conn);
}

function randomLetter() {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  return letters[Math.floor(Math.random() * letters.length)];
}

async function beginTurn(from, conn) {
  const db = load('db');
  const game = db[from];
  if (!game) return;

  clearTimer(turnTimers, from);

  const botJid = conn?.user?.id ? (conn.user.id.split(":")[0] + "@s.whatsapp.net") : null;
  const currentPlayer = game.players[game.turn];
  const minLen = computeMinLen(game.level);

  // AI move (bot must provide a word starting with game.lastStartLetter)
  if (game.aiEnabled && botJid && currentPlayer === botJid) {
    setTimeout(async () => {
      const startLetter = game.lastStartLetter || randomLetter();
      const nextWord = await getSuggestionStartsWith(startLetter, minLen);
      if (!nextWord) {
        // AI gives up -> other player wins
        await conn.sendMessage(from, { text: `🤖 AI couldn't find a word. Remaining player wins!` }, { quoted: mek });
        const winner = game.players.find(p => p !== botJid) || botJid;
        updateStats(winner, true);
        await endGameAndCleanup(from, conn, `${winner} wins because AI failed.`);
        return;
      }
      // Accept AI word
      game.lastWord = nextWord.toLowerCase();
      game.words.push({ word: game.lastWord, player: botJid });
      game.byPlayer[botJid] = game.byPlayer[botJid] || [];
      game.byPlayer[botJid].push(game.lastWord);
      game.wordCounts[botJid] = (game.wordCounts[botJid] || 0) + 1;
      game.acceptedCount = (game.acceptedCount || 0) + 1;
      // after a successful word, choose a new start letter for next turn (bot chooses)
      game.lastStartLetter = randomLetter();
      await conn.sendMessage(from, { text: `🤖 *AI:* ${game.lastWord.toUpperCase()}\n🔜 Next starter letter: *${game.lastStartLetter.toUpperCase()}*` }, { quoted: mek });
      // level up logic
      if (game.acceptedCount >= LEVEL_UP_THRESHOLD) {
        game.acceptedCount = 0;
        if ((game.level || 1) < 13) { // cap level so minLen doesn't exceed 15
          game.level = (game.level || 1) + 1;
        }
        await conn.sendMessage(from, { text: `⬆️ Difficulty increased. New min length: ${computeMinLen(game.level)}` }, { quoted: mek });
      }
      game.turn = getNextTurn(game);
      saveAllGames(db);
      beginTurn(from, conn);
    }, aiThinkDelay);
    return;
  }

  // announce turn: include required starter letter and min length
  try {
    await conn.sendMessage(from, {
      text: `🎯 @${currentPlayer.split("@")[0]}'s turn!\nStart your word with: *${(game.lastStartLetter || randomLetter()).toUpperCase()}*\nMinimum length: *${minLen}*\n⏳ ${Math.round(TURN_TIMEOUT/1000)}s`,
      mentions: [currentPlayer]
    }, { quoted: mek });
  } catch {
    await conn.sendMessage(from, { text: `It's @${currentPlayer.split("@")[0]}'s turn! Start with ${game.lastStartLetter.toUpperCase()}` }, { quoted: mek });
  }

  // start timeout for this turn
  turnTimers[from] = setTimeout(async () => {
    try {
      await conn.sendMessage(from, {
        text: `⏰ Time's up! @${currentPlayer.split("@")[0]} eliminated!`,
        mentions: [currentPlayer]
      }, { quoted: mek });
    } catch {}
    // eliminate currentPlayer
    const idx = game.players.indexOf(currentPlayer);
    if (idx !== -1) game.players.splice(idx, 1);

    if (game.players.length === 1) {
      const winner = game.players[0];
      try {
        await conn.sendMessage(from, { text: `🏆 Winner: @${winner.split("@")[0]}!`, mentions: [winner] }, { quoted: mek });
      } catch {}
      updateStats(winner, true);
      await endGameAndCleanup(from, conn, `Winner: @${winner.split("@")[0]}`);
      return;
    }

    if (game.turn >= game.players.length) game.turn = 0;
    saveAllGames(db);
    beginTurn(from, conn);
  }, TURN_TIMEOUT);

  saveAllGames(db);
}

/* ---------------- command registrations ---------------- */

// IMPORTANT: pattern must be a simple string the loader can match (not a regex)
cast({
  pattern: "wcg",
  desc: "Start Word Chain Game",
  category: 'game',
  filename: __filename
}, async (conn, mek, m, { from, sender, args, reply }) => {
  const chat = from || m.key?.remoteJid;
  const who = sender || (m.key?.participant || m.key?.remoteJid);

  const mode = (args && args[0]) ? args[0].toLowerCase() : "easy";
  const db = load('db');

  if (!db[chat]) {
    db[chat] = {
      mode,
      host: who,
      players: [who],
      waiting: true,
      createdAt: Date.now(),
      level: 1,
      acceptedCount: 0,
      lastStartLetter: randomLetter(),
      words: [],
      byPlayer: {},
      wordCounts: {}
    };

    try {
      await conn.sendMessage(chat, { text: `🎉 Word Chain Game started in *${mode.toUpperCase()}* mode!\nType *join* to enter.\nType *wcgstop* to cancel the lobby/game (host only).\n⏳ Game starts in ${Math.round(JOIN_TIMEOUT/1000)}s\nStarter letter: *${db[chat].lastStartLetter.toUpperCase()}*` }, { quoted: mek });
    } catch { if (reply) reply(`🎉 Word Chain Game started in ${mode.toUpperCase()} mode!`); }

    clearTimer(startTimers, chat);
    startTimers[chat] = setTimeout(async () => {
      const local = load('db');
      if (!local[chat] || (local[chat].players || []).length === 0) {
        try { await conn.sendMessage(chat, { text: "❌ No players joined. Game canceled." }, { quoted: mek }); } catch {}
        delete local[chat];
        saveAllGames(local);
        return;
      }
      await startGame(chat, conn);
    }, JOIN_TIMEOUT);

    saveAllGames(db);
  } else {
    if (reply) return reply("⚠️ A game is already active in this chat.");
    try { await conn.sendMessage(chat, { text: "⚠️ A game is already active in this chat." }, { quoted: mek }); } catch {}
  }
});

cast({
  pattern: "join",
  desc: "Join Word Chain Game",
  filename: __filename
}, async (conn, mek, m, { from, sender, reply }) => {
  const chat = from || m.key?.remoteJid;
  const who = sender || (m.key?.participant || m.key?.remoteJid);
  const db = load('db');
  const game = db[chat];
  if (!game || !game.waiting) return reply ? reply("❌ No game to join.") : await conn.sendMessage(chat, { text: "❌ No game to join." }, { quoted: mek });
  if (game.players.includes(who)) return reply ? reply("⚠️ You're already in.") : await conn.sendMessage(chat, { text: "⚠️ You're already in." }, { quoted: mek });
  if (game.players.length >= MAX_PLAYERS) return reply ? reply("🚫 Game full.") : await conn.sendMessage(chat, { text: "🚫 Game full." }, { quoted: mek });

  game.players.push(who);
  saveAllGames(db);
  try {
    await conn.sendMessage(chat, { text: `✅ @${who.split("@")[0]} joined!`, mentions: [who] }, { quoted: mek });
  } catch {
    if (reply) reply(`✅ ${who.split("@")[0]} joined!`);
  }
});

// manual stop command - host or admin can stop
cast({
  pattern: "wcgstop",
  desc: "Stop / cancel the WCG lobby or running game (host only)",
  category: 'game',
  filename: __filename
}, async (conn, mek, m, { from, sender, reply, isGroup, groupMetadata }) => {
  const chat = from || m.key?.remoteJid;
  const db = load('db');
  const game = db[chat];
  if (!game) return reply("No active game to stop.");
  // allow host or group admin to stop
  const host = game.host;
  let isHost = host === sender;
  let isAdmin = false;
  try {
    if (isGroup && groupMetadata) {
      const admins = (groupMetadata.participants || []).filter(p => p.admin).map(p => p.id);
      isAdmin = admins.includes(sender);
    }
  } catch (e) { /* ignore */ }

  if (!isHost && !isAdmin) return reply("Only the host or a group admin can stop the game.");

  await endGameAndCleanup(chat, conn, "Game stopped by host/admin.");
  return reply("✅ Game stopped.");
});

// stats and leaderboard
cast({
  pattern: "wcg-stats",
  desc: "Your WCG stats",
  filename: __filename
}, async (conn, mek, m, { sender, reply }) => {
  const stats = loadStats();
  const userStats = stats[sender];
  if (!userStats) return reply ? reply("No stats yet. Play a game!") : await conn.sendMessage(m.key?.remoteJid, { text: "No stats yet." }, { quoted: mek });
  const { wins, losses, played } = userStats;
  return reply ? reply(`📊 *Your Stats*\nPlayed: ${played}\nWins: ${wins}\nLosses: ${losses}`) : await conn.sendMessage(m.key?.remoteJid, { text: `📊 Stats: Played ${played}, Wins ${wins}` }, { quoted: mek });
});

cast({
  pattern: "leaderboard",
  desc: "WCG Leaderboard",
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  const stats = loadStats();
  const sorted = Object.entries(stats).sort((a, b) => (b[1].wins || 0) - (a[1].wins || 0)).slice(0, 10);
  if (!sorted.length) return reply ? reply("No data yet.") : await conn.sendMessage(m.key?.remoteJid, { text: "No data yet." }, { quoted: mek });
  const list = sorted.map(([id, s], i) => `${emojiRank(i)} @${id.split("@")[0]} - ${s.wins || 0} Wins`).join("\n");
  return reply ? reply(`🏆 *Leaderboard*\n\n${list}`, null, { mentions: sorted.map(([id]) => id) }) : await conn.sendMessage(m.key?.remoteJid, { text: `🏆 Leaderboard\n\n${list}` }, { quoted: mek });
});

/* ---------------- messages listener (for in-game words without prefix) ---------------- */
async function handlePlayerMessage(mek, conn) {
  try {
    if (!mek || !mek.message) return;
    const from = mek.key.remoteJid;
    if (!from) return;
    // skip statuses and broadcasts
    if (!from.endsWith("@g.us")) return; // only group games
    const textVariants = [
      mek.message.conversation,
      mek.message?.extendedTextMessage?.text,
      mek.message?.imageMessage?.caption,
      mek.message?.videoMessage?.caption
    ];
    let text = (textVariants.find(Boolean) || "").trim();
    if (!text) return;
    if (text.startsWith(prefix)) return; // skip prefixed commands

    const db = load('db');
    const game = db[from];
    if (!game || game.waiting) return;

    const sender = mek.key.fromMe ? (conn.user.id.split(":")[0] + "@s.whatsapp.net") : (mek.key.participant || mek.key.remoteJid);
    const currentPlayer = game.players[game.turn];
    if (currentPlayer !== sender) return; // not their turn

    const word = text.toLowerCase().replace(/[^a-z]/gi, "");
    if (!word) return;

    const minLen = computeMinLen(game.level);
    const requiredStart = (game.lastStartLetter || randomLetter()).toLowerCase();

    // spam detection: if player's last word (their previous contribution) equals this word, warn only
    game.byPlayer = game.byPlayer || {};
    const playerWords = game.byPlayer[sender] || [];
    const lastPlayerWord = playerWords.length ? playerWords[playerWords.length - 1] : null;
    if (lastPlayerWord && lastPlayerWord.toLowerCase() === word) {
      await conn.sendMessage(from, { text: `⚠️ Spam detected. You already used that word. Try another one.`, mentions: [sender] }, { quoted: mek });
      return; // no penalty, keep turn running
    }

    // check starting letter
    if (!word.startsWith(requiredStart)) {
      await conn.sendMessage(from, { text: `❌ Word must start with *${requiredStart.toUpperCase()}*.`, mentions: [sender] }, { quoted: mek });
      return;
    }

    // check length
    if (word.length < minLen) {
      await conn.sendMessage(from, { text: `❗ Word must be at least ${minLen} letters long.`, mentions: [sender] }, { quoted: mek });
      return;
    }

    // check valid word via dictionary
    const valid = await isValidWord(word);
    if (!valid) {
      await conn.sendMessage(from, { text: `❌ Invalid English word. Try again.`, mentions: [sender] }, { quoted: mek });
      return;
    }

    // Accepted word: store
    game.lastWord = word;
    game.words = game.words || [];
    game.words.push({ word, player: sender, ts: Date.now() });
    game.byPlayer[sender] = game.byPlayer[sender] || [];
    game.byPlayer[sender].push(word);
    game.wordCounts = game.wordCounts || {};
    game.wordCounts[sender] = (game.wordCounts[sender] || 0) + 1;
    game.acceptedCount = (game.acceptedCount || 0) + 1;

    // announce acceptance and stats
    await conn.sendMessage(from, { text: `✅ Word *${word.toUpperCase()}* accepted!` }, { quoted: mek });

    // choose next starter letter randomly (bot chooses per request)
    game.lastStartLetter = randomLetter();

    // level up if threshold reached
    if (game.acceptedCount >= LEVEL_UP_THRESHOLD) {
      game.acceptedCount = 0;
      if ((game.level || 1) < 13) {
        game.level = (game.level || 1) + 1;
        await conn.sendMessage(from, { text: `⬆️ Difficulty increased. New min length: ${computeMinLen(game.level)}` }, { quoted: mek });
      }
    }

    // advance turn
    game.turn = getNextTurn(game);

    // clear current turn timer and restart next turn flow
    clearTimer(turnTimers, from);
    saveAllGames(db);

    // if only one player left -> end
    if (game.players.length === 1) {
      const winner = game.players[0];
      await conn.sendMessage(from, { text: `🏆 Winner: @${winner.split("@")[0]}!`, mentions: [winner] }, { quoted: mek });
      updateStats(winner, true);
      await endGameAndCleanup(from, conn, `Winner: @${winner.split("@")[0]}`);
      return;
    }

    beginTurn(from, conn);

  } catch (e) {
    console.error("WCG listener error:", e);
  }
}

function registerWCG(conn) {
  conn.ev.on("messages.upsert", async (up) => {
    try {
      const mek = up.messages[0];
      await handlePlayerMessage(mek, conn);
    } catch (e) {
      console.error("WCG: handler error", e);
    }
  });
  console.log("✅ WCG: registered messages.upsert listener.");
}

/* ---------------- end-game summary & cleanup ---------------- */

async function endGameAndCleanup(from, conn, reasonText = "Game ended") {
  try {
    const db = load('db');
    const game = db[from];
    if (!game) {
      // ensure we clear timers anyway
      clearTimer(startTimers, from);
      clearTimer(turnTimers, from);
      return;
    }

    // compute winner: player with highest wordCounts (if players left, pick last standing)
    let winner = null;
    if (game.players && game.players.length === 1) winner = game.players[0];
    // otherwise choose highest wordCounts
    if (!winner) {
      const counts = game.wordCounts || {};
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      if (sorted.length) winner = sorted[0][0];
    }

    // compute longest word overall
    const allWords = game.words || [];
    const longest = allWords.reduce((acc, cur) => {
      if (!acc || (cur.word && cur.word.length > acc.word.length)) return cur;
      return acc;
    }, null);

    // winner answered count
    const winnerCount = (game.wordCounts && winner) ? (game.wordCounts[winner] || 0) : 0;

    // build per-player results
    const results = [];
    const playersSeen = new Set();
    if (game.byPlayer) {
      for (const p of Object.keys(game.byPlayer)) {
        playersSeen.add(p);
        results.push({ player: p, count: game.wordCounts[p] || game.byPlayer[p].length, words: game.byPlayer[p] });
      }
    }
    // include any players left who didn't play words
    if (game.players) {
      for (const p of game.players) {
        if (!playersSeen.has(p)) results.push({ player: p, count: game.wordCounts[p] || 0, words: game.byPlayer[p] || [] });
      }
    }

    // format summary
    let summary = `🔚 *Game Ended* — ${reasonText}\n\n`;
    if (winner) summary += `🏆 Winner: @${winner.split("@")[0]} — ${winnerCount} word(s)\n`;
    summary += `📦 Longest word: ${longest ? `*${longest.word.toUpperCase()}* by @${longest.player.split("@")[0]} (${longest.word.length} letters)` : "N/A"}\n\n`;
    summary += `📊 Final per-player counts:\n`;
    results.sort((a,b) => b.count - a.count);
    for (const r of results) {
      summary += `• @${r.player.split("@")[0]} — ${r.count} word(s)\n`;
    }
    summary += `\nThanks for playing!`;

    // send summary with mentions
    const mentions = results.map(r => r.player);
    try {
      await conn.sendMessage(from, { text: summary, mentions }, { quoted: mek });
    } catch (e) {
      try { await conn.sendMessage(from, { text: summary }, { quoted: mek }); } catch {}
    }

    // update stats persistence for winner
    if (winner) updateStats(winner, true);

    // cleanup timers and DB entry
    clearTimer(startTimers, from);
    clearTimer(turnTimers, from);
    delete db[from];
    saveAllGames(db);

  } catch (e) {
    console.error("WCG end/cleanup error", e);
  }
}

module.exports = { handleGameText, registerWCG, startGame, beginTurn };

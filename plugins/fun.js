'use strict';

const { cast, makeSmartQuote, applyFont } = require('../cast');

const config = require('../config');
const axios = require('axios');
const fetch = require('node-fetch');

const { sleep } = require('../lib/functions');

// ── GROUP FUN — couple/gay/lesbian/crush/roast/rate/king/tod/kickrandom 
// fun-compat-commands.js

// ----------------- GLOBAL HELPERS (define once) -----------------
const extractMentions = (m, mek) => {
  // preferred: message.mentionedJid (some baileys versions)
  try {
    if (Array.isArray(m?.mentionedJid) && m.mentionedJid.length) return m.mentionedJid;
  } catch (e) {}
  // fallback: extendedTextMessage.contextInfo.mentionedJid
  try {
    const ctx = mek?.message?.extendedTextMessage?.contextInfo;
    if (ctx && Array.isArray(ctx.mentionedJid) && ctx.mentionedJid.length) return ctx.mentionedJid;
  } catch (e) {}
  return [];
};

const hashString = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
};

const makeBar = (p) => {
  const filled = Math.round((p / 100) * 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty) + ` ${p}%`;
};

const short = (jid) => (typeof jid === "string" ? jid.split("@")[0] : jid);

// safe helper to get group members (array of jids)
const groupMembers = (groupMetadata, conn) => {
  if (!groupMetadata || !Array.isArray(groupMetadata.participants)) return [];
  let members = groupMetadata.participants.map((p) => p.id || p.jid || p);
  // remove bot itself if available
  const botJid = conn?.user?.jid || conn?.user?.id || null;
  if (botJid) members = members.filter((x) => x !== botJid);
  return members;
};

// ----------------- COUPLE COMMAND -----------------
cast(
  {
    pattern: "couple",
    desc: "Pairs two group members and shows compatibility 💞",
    category: 'fun',
    filename: __filename,
  },
  async (conn, mek, m, { from, reply, isGroup, groupMetadata }) => {
    try {
      if (!isGroup) return reply("🚫 *This command can only be used in groups!*");

      const mentionsInMessage = extractMentions(m, mek);
      let members = groupMembers(groupMetadata, conn);
      if (members.length < 2) return reply("❌ *Not enough members to pair!*");

      let p1, p2;
      if (mentionsInMessage.length >= 2) {
        p1 = mentionsInMessage[0];
        p2 = mentionsInMessage[1];
      } else if (mentionsInMessage.length === 1) {
        p1 = mentionsInMessage[0];
        const others = members.filter((x) => x !== p1);
        if (others.length === 0) return reply("❌ *No other members to pair with.*");
        p2 = others[Math.floor(Math.random() * others.length)];
      } else {
        const shuffled = members.sort(() => Math.random() - 0.5);
        p1 = shuffled[0];
        p2 = shuffled[1];
      }

      if (p1 === p2) {
        const others = members.filter((x) => x !== p1);
        if (others.length === 0) return reply("❌ *Not enough different members to pair.*");
        p2 = others[Math.floor(Math.random() * others.length)];
      }

      const sortedPairKey = [p1, p2].sort().join("|");
      const percent = hashString(sortedPairKey) % 101; // 0..100

      const compatibility = (n) => {
        if (n >= 90) return { label: "💖 Soulmates", text: "A legendary match — sparks everywhere! Expect fireworks, understanding and memes together.", emoji: "💘" };
        if (n >= 70) return { label: "💕 Excellent", text: "Great chemistry and lots of shared vibes. Could be a power couple.", emoji: "😍" };
        if (n >= 50) return { label: "💞 Good", text: "Nice potential — with effort this could blossom into something real.", emoji: "🙂" };
        if (n >= 30) return { label: "💔 Low", text: "It's a tough match — different wavelengths. Still, opposites can learn a lot from each other.", emoji: "😬" };
        return { label: "🧡 Very Low", text: "Hmm... not compatible by the stars today. Maybe great as friends!", emoji: "🤝" };
      };

      const band = compatibility(percent);

      const lines = [];
      lines.push("💘 *Perfect Match Alert!* 💘");
      lines.push("");
      lines.push(`❤️ *@${short(p1)}* ${band.emoji} *@${short(p2)}* ❤️`);
      lines.push("");
      lines.push(`*Compatibility:* ${band.label}`);
      lines.push(makeBar(percent));
      lines.push("");
      lines.push(band.text);
      lines.push("");
      lines.push("_Tip: Use_ `couple @member` _to pair a specific member with a random match, or_ `couple @a @b` _to check two specific members._");

      const mentions = [p1, p2];
      return await conn.sendMessage(from, { text: lines.join("\n"), mentions }, { quoted: mek });
    } catch (e) {
      console.log(e);
      return reply(`❌ *Error:* ${e.message || e}`);
    }
  }
);

// ----------------- GAY COMMAND -----------------
cast(
  {
    pattern: "gay",
    desc: "Calculate how gay a member is (fun).",
    category: 'fun',
    filename: __filename,
  },
  async (conn, mek, m, { from, reply, isGroup, groupMetadata }) => {
    try {
      if (!isGroup) return reply("🚫 *This command can only be used in groups!*");

      const mentions = extractMentions(m, mek);
      const members = groupMembers(groupMetadata, conn);
      if (members.length === 0) return reply("❌ *No members found.*");

      const target = mentions.length >= 1 ? mentions[0] : members[Math.floor(Math.random() * members.length)];
      const percent = hashString(target + "-gay") % 101;

      const msg = (n) => {
        if (n >= 90) return "🌈 *Iconic!* Absolute vibes. Proud energy overload.";
        if (n >= 70) return "🏳️‍🌈 *Very gay!* Strong rainbow energy.";
        if (n >= 50) return "✨ *Pretty gay.* Comfortable and confident.";
        if (n >= 30) return "🙂 *A little gay.* Could surprise you.";
        return "🤭 *Not very gay.* Or secretly very gay — plot twist!";
      };

      const lines = [];
      lines.push(`🏳️‍🌈 *@${short(target)}*'s gay level`);
      lines.push(makeBar(percent));
      lines.push("");
      lines.push(msg(percent));

      return await conn.sendMessage(from, { text: lines.join("\n"), mentions: [target] }, { quoted: mek });
    } catch (e) {
      console.log(e);
      return reply(`❌ *Error:* ${e.message || e}`);
    }
  }
);

// ----------------- LESBIAN COMMAND -----------------
cast(
  {
    pattern: "lesbian",
    desc: "Calculate how lesbian a member is (fun).",
    category: 'fun',
    filename: __filename,
  },
  async (conn, mek, m, { from, reply, isGroup, groupMetadata }) => {
    try {
      if (!isGroup) return reply("🚫 *This command can only be used in groups!*");

      const mentions = extractMentions(m, mek);
      const members = groupMembers(groupMetadata, conn);
      if (members.length === 0) return reply("❌ *No members found.*");

      const target = mentions.length >= 1 ? mentions[0] : members[Math.floor(Math.random() * members.length)];
      const percent = hashString(target + "-lesbian") % 101;

      const msg = (n) => {
        if (n >= 90) return "🌸 *Legendary lesbian energy!* Unapologetic and iconic.";
        if (n >= 70) return "💗 *Very lesbian!* Strong gay-sister vibes.";
        if (n >= 50) return "🎀 *Pretty lesbian.* Comfortable in who they are.";
        if (n >= 30) return "🙂 *A little lesbian.* Might be exploring.";
        return "🤭 *Not very lesbian.* Or secretly crushing — who knows!";
      };

      const lines = [];
      lines.push(`💗 *@${short(target)}*'s lesbian level`);
      lines.push(makeBar(percent));
      lines.push("");
      lines.push(msg(percent));

      return await conn.sendMessage(from, { text: lines.join("\n"), mentions: [target] }, { quoted: mek });
    } catch (e) {
      console.log(e);
      return reply(`❌ *Error:* ${e.message || e}`);
    }
  }
);

// ----------------- CRUSH COMMAND -----------------
// ----------------- CRUSH COMMAND (improved) -----------------
// ----------------- CRUSH COMMAND (fixed null-safe) -----------------
cast(
  {
    pattern: "crush",
    desc: "Reveal someone's crush (for fun). Supports: crush, crush @target, crush @target @crush",
    category: 'fun',
    filename: __filename,
  },
  async (conn, mek, m, { from, reply, isGroup, groupMetadata }) => {
    try {
      if (!isGroup) return reply("🚫 *This command can only be used in groups!*");

      const mentions = extractMentions(m, mek);
      let members = groupMembers(groupMetadata, conn);
      members = members.filter(Boolean); // remove any null/undefined

      if (members.length < 2) return reply("❌ *Not enough members to determine a crush.*");

      let target, crush;

      if (mentions.length >= 2) {
        target = mentions[0] || members[Math.floor(Math.random() * members.length)];
        crush = mentions[1] || members.find((m) => m !== target);
        if (target === crush) {
          const others = members.filter((x) => x !== target);
          crush = others[Math.floor(Math.random() * others.length)];
        }
      } else if (mentions.length === 1) {
        target = mentions[0] || members[Math.floor(Math.random() * members.length)];
        const candidates = members.filter((x) => x !== target);
        crush = candidates[Math.floor(Math.random() * candidates.length)];
      } else {
        target = members[Math.floor(Math.random() * members.length)];
        const candidates = members.filter((x) => x !== target);
        crush = candidates[Math.floor(Math.random() * candidates.length)];
      }

      // final safety check
      if (!target) target = members[0];
      if (!crush) crush = members.find((m) => m !== target) || members[0];

      const percent = Math.floor(Math.random() * 101);

      const lines = [];
      lines.push(`💘 *@${short(target)}*'s crush is *@${short(crush)}*!`);
      lines.push(makeBar(percent));
      lines.push("");
      lines.push("_Slide in their dm's and shoot your shot and take your L_");

      return await conn.sendMessage(
        from,
        { text: lines.join("\n"), mentions: [target, crush].filter(Boolean) },
        { quoted: mek }
      );
    } catch (e) {
      console.log(e);
      return reply(`❌ *Error:* ${e.message || e}`);
    }
  }
);

// ----------------- ROAST COMMAND (improved, mentionable) -----------------
cast(
  {
    pattern: "roast",
    desc: "Roasts a random group member or a mentioned member 🔥 (use roast @member)",
    category: 'fun',
    filename: __filename,
  },
  async (conn, mek, m, { from, reply, isGroup, groupMetadata }) => {
    try {
      if (!isGroup) return reply("🚫 *This command can only be used in groups!*");

      const mentions = extractMentions(m, mek);
      const members = groupMembers(groupMetadata, conn);
      if (members.length < 1) return reply("❌ *Not enough members!*");

      // If mention provided, roast that person; otherwise choose random
      const victim = mentions.length >= 1 ? mentions[0] : members[Math.floor(Math.random() * members.length)];

      const roasts = [
        "You're not stupid — you just have bad luck thinking.",
        "If I wanted to kill myself I'd climb your ego and jump to your IQ.",
        "I'd explain it to you but I left my crayons at home.",
        "You’re the reason the gene pool needs a lifeguard.",
        "You're like a cloud. When you disappear, it's a beautiful day.",
        "If ignorance is bliss, you must be the happiest person alive.",
        "You bring everyone so much joy… when you leave the room.",
        "Some drink from the fountain of knowledge; you only gargled.",
        "You have the face for radio and the voice for silent movies.",
        "I’d call you a tool, but even they serve a purpose.",
        "You're proof that evolution can go in reverse.",
        "You're like a software update. Whenever I see you I think: later.",
        "You're not the sharpest knife in the drawer… but you might be the spoon.",
        "Congratulations — you’re the reason we have warning labels.",
        "You'd struggle to pour water out of a boot with instructions written on the heel.",
        "Your secrets are safe with me — I wasn't even listening.",
        "I'd tell you to go to hell, but I work there and don't want the competition.",
        "You have the personality of a dial tone.",
        "You're the human equivalent of a participation trophy.",
        "If laughter is the best medicine, your presence is definitely a placebo."
      ];

      const roastMessage = roasts[Math.floor(Math.random() * roasts.length)];

      const text = `🔥 *Roast Time!* 🔥\n\n🤡 *@${short(victim)}*, ${roastMessage}`;

      return await conn.sendMessage(from, { text, mentions: [victim] }, { quoted: mek });
    } catch (e) {
      console.log(e);
      return reply(`❌ *Error:* ${e.message || e}`);
    }
  }
);

// ----------------- RATE COMMAND -----------------
cast(
  {
    pattern: "rate",
    desc: "Rate a member from 1 to 100 (fun).",
    category: 'fun',
    filename: __filename,
  },
  async (conn, mek, m, { from, reply, isGroup, groupMetadata }) => {
    try {
      if (!isGroup) return reply("🚫 *This command can only be used in groups!*");

      const mentions = extractMentions(m, mek);
      const members = groupMembers(groupMetadata, conn);
      if (members.length === 0) return reply("❌ *No members found.*");

      const target = mentions.length >= 1 ? mentions[0] : members[Math.floor(Math.random() * members.length)];
      const percent = (hashString(target + "-rate") % 100) + 1; // 1..100

      const bandMsg = (n) => {
        if (n >= 90) return "🏆 *Legend!* Everybody loves them.";
        if (n >= 75) return "🌟 *Amazing!* Top-tier human.";
        if (n >= 50) return "👍 *Good!* Solid presence.";
        if (n >= 30) return "😅 *Okay.* Needs work.";
        return "🤨 *Oof.* We all have off days — be kind!";
      };

      const lines = [];
      lines.push(`📊 Rating for *@${short(target)}*`);
      lines.push(makeBar(percent));
      lines.push("");
      lines.push(bandMsg(percent));

      return await conn.sendMessage(from, { text: lines.join("\n"), mentions: [target] }, { quoted: mek });
    } catch (e) {
      console.log(e);
      return reply(`❌ *Error:* ${e.message || e}`);
    }
  }
);

cast(
  {
    pattern: "king",
    desc: "Randomly selects a group king 👑",
    category: 'fun',
    filename: __filename,
  },
  async (conn, mek, m, { from, reply, isGroup, groupMetadata }) => {
    try {
      if (!isGroup) return reply("🚫 *This command can only be used in groups!*");

      let members = groupMetadata.participants.map((p) => p.id);
      if (members.length < 1) return reply("❌ *Not enough members!*");

      let king = members[Math.floor(Math.random() * members.length)];

      let text = `👑 *Bow down to the new King!* 👑\n\n🥶 *@${king.split("@")[0]}* now rules this group! 🤴🔥`;

      return await conn.sendMessage(from, { text, mentions: [king] }, { quoted: mek });
    } catch (e) {
      console.log(e);
      return reply(`❌ *Error:* ${e}`);
    }
  }
);

cast(
  {
    pattern: "tod",
    desc: "Gives a random Truth or Dare challenge 🎭",
    category: 'fun',
    filename: __filename,
  },
  async (conn, mek, m, { from, reply, isGroup }) => {
    try {
      if (!isGroup) return reply("🚫 *This command can only be used in groups!*");

      let truths = [
        "What’s your biggest secret? 🤫",
        "Have you ever had a crush on someone in this group? 😏",
        "What's the most embarrassing thing you've done? 😆",
      ];

      let dares = [
        "Send a love confession to the first person in your chat. 💌",
        "Talk like a baby for the next 5 messages. 👶",
        "Send a selfie making the weirdest face. 🤪",
      ];

      let choice = Math.random() > 0.5 ? "Truth" : "Dare";
      let challenge = choice === "Truth" ? truths[Math.floor(Math.random() * truths.length)] : dares[Math.floor(Math.random() * dares.length)];

      let text = `🎭 *Truth or Dare!* 🎭\n\n🤔 *You got:* *${choice}*\n👉 ${challenge}`;

      return await conn.sendMessage(from, { text }, { quoted: mek });
    } catch (e) {
      console.log(e);
      return reply(`❌ *Error:* ${e}`);
    }
  }
);

cast(
  {
    pattern: "kickrandom",
    desc: "Randomly kicks a member 😈",
    category: 'fun',
    filename: __filename,
  },
  async (conn, mek, m, { from, reply, isGroup, groupMetadata }) => {
    try {
      if (!isGroup) return reply("🚫 *This command can only be used in groups!*");

      let admins = groupMetadata.participants.filter((p) => p.admin).map((p) => p.id);
      let isAdmin = admins.includes(m.sender);
      if (!isAdmin) return reply("⚠️ *Only admins can use this command!*");

      let members = groupMetadata.participants.filter((p) => !p.admin).map((p) => p.id);
      if (members.length < 1) return reply("❌ *No kickable members found!*");

      let unlucky = members[Math.floor(Math.random() * members.length)];

      await conn.groupParticipantsUpdate(from, [unlucky], "remove");

      let text = `😈 *Random Kick Activated!* 🚀\n\n💀 *@${unlucky.split("@")[0]}* has been banished from the group! ☠️`;

      return await conn.sendMessage(from, { text, mentions: [unlucky] }, { quoted: mek });
    } catch (e) {
      console.log(e);
      return reply(`❌ *Error:* ${e}`);
    }
  }
);

// ── FUN EXTRAS — rizz/truth/dare/joke/fact/quotes/ud/fakeinfo/insult 

// ─── Shared fetch helpers ────────────────────────────────────────────────

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── rizz ────────────────────────────────────────────────────────────────

cast({
  pattern: 'rizz',
  desc: 'Get a random pickup line.',
  category: 'fun',
  react: '😏',
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  try {
    const data = await fetchJson('https://api.popcat.xyz/pickuplines');
    await reply(`😏 ${data.pickupline}`);
  } catch (e) {
    console.error('rizz error:', e);
    await reply('❌ Could not fetch a pickup line right now. Try again!');
  }
});

// ─── question ────────────────────────────────────────────────────────────

cast({
  pattern: 'question',
  desc: 'Get a random fun question.',
  category: 'fun',
  react: '❓',
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  try {
    // Uses a public trivia/question API
    const data = await fetchJson('https://opentdb.com/api.php?amount=1&type=multiple');
    const q = data.results[0];
    await reply(`❓ *Question:*\n${q.question.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&')}\n\n📂 _Category: ${q.category} | Difficulty: ${q.difficulty}_`);
  } catch (e) {
    console.error('question error:', e);
    await reply('❌ Could not fetch a question right now.');
  }
});

// ─── truth ───────────────────────────────────────────────────────────────

cast({
  pattern: 'truth',
  desc: 'Get a truth dare — truth.',
  category: 'fun',
  react: '🫣',
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  try {
    const data = await fetchJson('https://api.truthordarebot.xyz/v1/truth');
    await reply(`🫣 *Truth:*\n${data.question}`);
  } catch (e) {
    console.error('truth error:', e);
    await reply('❌ Could not fetch a truth question right now.');
  }
});

// ─── dare ────────────────────────────────────────────────────────────────

cast({
  pattern: 'dare',
  desc: 'Get a truth dare — dare.',
  category: 'fun',
  react: '😈',
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  try {
    const data = await fetchJson('https://api.truthordarebot.xyz/v1/dare');
    await reply(`😈 *Dare:*\n${data.question}`);
  } catch (e) {
    console.error('dare error:', e);
    await reply('❌ Could not fetch a dare right now.');
  }
});

// ─── joke ────────────────────────────────────────────────────────────────

cast({
  pattern: 'joke',
  desc: 'Get a random joke.',
  category: 'fun',
  react: '😂',
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  try {
    const data = await fetchJson('https://official-joke-api.appspot.com/random_joke');
    await reply(`😂 *${data.setup}*\n\n🥁 ${data.punchline}`);
  } catch (e) {
    console.error('joke error:', e);
    await reply('❌ Could not fetch a joke right now.');
  }
});

// ─── joke2 ───────────────────────────────────────────────────────────────

cast({
  pattern: 'joke2',
  alias: ['darkjoke'],
  desc: 'Get a single-line joke.',
  category: 'fun',
  react: '😂',
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  try {
    const data = await fetchJson('https://v2.jokeapi.dev/joke/Any?type=single');
    await reply(`😂 ${data.joke}`);
  } catch (e) {
    console.error('joke2 error:', e);
    await reply('❌ Could not fetch a joke right now.');
  }
});

// ─── fact ────────────────────────────────────────────────────────────────

cast({
  pattern: 'fact',
  desc: 'Get a random fun fact.',
  category: 'fun',
  react: '🧠',
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  try {
    const { data } = await axios.get('https://nekos.life/api/v2/fact');
    await reply(`🧠 *Fact:*\n${data.fact}`);
  } catch (e) {
    console.error('fact error:', e);
    await reply('❌ Could not fetch a fact right now.');
  }
});

// ─── quotes ──────────────────────────────────────────────────────────────

cast({
  pattern: 'quotes',
  alias: ['qotd'],
  desc: 'Get the quote of the day.',
  category: 'fun',
  react: '🎗️',
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  try {
    const { data } = await axios.get('https://favqs.com/api/qotd');
    const q = data.quote;
    await reply(
      `╔════◇\n` +
      `║ 🎗️ *${q.body}*\n` +
      `║\n` +
      `║ 👤 _— ${q.author}_\n` +
      `╚════════════╝`
    );
  } catch (e) {
    console.error('quotes error:', e);
    await reply('❌ Could not fetch a quote right now.');
  }
});

// ─── define (Urban Dictionary) ────────────────────────────────────────────

cast({
  pattern: 'ud',
  alias: ['urbandictionary', 'urban'],
  desc: 'Look up a word on Urban Dictionary.',
  category: 'fun',
  react: '📖',
  filename: __filename
}, async (conn, mek, m, { q, reply, pushname }) => {
  try {
    const word = q || (m.quoted && m.quoted.text);
    if (!word) return reply(`📖 Please tell me what word to define.\nExample: *define slay*`);

    const { data } = await axios.get(`http://api.urbandictionary.com/v0/define?term=${encodeURIComponent(word)}`);

    if (!data || !data.list || !data.list.length) {
      return reply(`❌ No Urban Dictionary results found for *${word}*.`);
    }

    const entry = data.list[0];
    const definition = entry.definition.replace(/\[/g, '').replace(/\]/g, '');
    const example = entry.example.replace(/\[/g, '').replace(/\]/g, '');

    await reply(
      `📖 *${word}*\n\n` +
      `*Definition:*\n${definition}\n\n` +
      `*Example:*\n_${example || 'N/A'}_\n\n` +
      `👍 ${entry.thumbs_up}  👎 ${entry.thumbs_down}`
    );
  } catch (e) {
    console.error('define error:', e);
    await reply('❌ Could not look up that word right now.');
  }
});

// ─── fakeinfo ─────────────────────────────────────────────────────────────

cast({
  pattern: 'fakeinfo',
  alias: ['fakeid'],
  desc: 'Generate a fake identity.',
  category: 'fun',
  react: '🪪',
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  try {
    // randomuser.me is the reliable public API for fake identities
    const { data } = await axios.get('https://randomuser.me/api/');
    const p = data.results[0];
    const name = `${p.name.title} ${p.name.first} ${p.name.last}`;
    const dob = new Date(p.dob.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

    await reply(
      `🪪 *Fake Identity*\n\n` +
      `👤 *Name:* ${name}\n` +
      `📅 *DOB:* ${dob} (Age ${p.dob.age})\n` +
      `🚻 *Gender:* ${p.gender}\n` +
      `📞 *Phone:* ${p.phone}\n` +
      `📧 *Email:* ${p.email}\n` +
      `🌍 *Location:* ${p.location.city}, ${p.location.state}, ${p.location.country}\n` +
      `🔑 *Username:* ${p.login.username}\n` +
      `🔒 *Password:* ${p.login.password}`
    );
  } catch (e) {
    console.error('fakeinfo error:', e);
    await reply('❌ Could not generate fake info right now.');
  }
});

// ─── insult ───────────────────────────────────────────────────────────────

cast({
  pattern: 'insult',
  desc: 'Get a random (harmless) insult.',
  category: 'fun',
  react: '😤',
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  try {
    // evilinsult.com is a reliable public API
    const { data } = await axios.get('https://evilinsult.com/generate_insult.php?lang=en&type=json');
    await reply(`😤 ${data.insult}`);
  } catch (e) {
    console.error('insult error:', e);
    await reply('❌ Could not fetch an insult right now.');
  }
});

// ─── lines ────────────────────────────────────────────────────────────────

cast({
  pattern: 'lines',
  alias: ['nicemsg', 'positivity'],
  desc: 'Get a nice positive message.',
  category: 'fun',
  react: '🌸',
  filename: __filename
}, async (conn, mek, m, { reply }) => {
  try {
    const { data } = await axios.get('https://zenquotes.io/api/random');
    const q = data[0];
    await reply(`🌸 *${q.q}*\n\n_— ${q.a}_`);
  } catch (e) {
    console.error('lines error:', e);
    await reply('❌ Could not fetch a message right now.');
  }
});

// ── HACK PRANK ────────────────────────────────────────

cast({
  pattern: 'hack',
  desc: 'Hacking prank animation',
  category: 'fun',
  react: '💀',
  filename: __filename
}, async (conn, mek, m, { from, reply }) => {
  try {
    const messages = [
      '🔍 *Kylie Injecting Malware...*',
      '▓░░░░░░░░░  10%',
      '▓▓░░░░░░░░  20%',
      '▓▓▓░░░░░░░  30%',
      '▓▓▓▓░░░░░░  40%',
      '▓▓▓▓▓░░░░░  50%',
      '▓▓▓▓▓▓░░░░  60%',
      '▓▓▓▓▓▓▓░░░  70%',
      '▓▓▓▓▓▓▓▓░░  80%',
      '▓▓▓▓▓▓▓▓▓░  90%',
      '▓▓▓▓▓▓▓▓▓▓  100%',
      '⚙️ *System hijacking in progress...*\n🔗 Connecting to server... Error 404',
      '✅ *Device successfully connected...*\n📥 Receiving data...',
      '💾 *Data hijacked from device 100% completed*\n🧹 Killing all evidence...',
      '💥 *HACKING COMPLETED*',
      '📤 *SENDING LOG DOCUMENTS...*',
      '✔️ *SUCCESSFULLY SENT DATA. Connection disconnected.*',
      '🗑️ *BACKLOGS CLEARED*'
    ];
    const sent = await conn.sendMessage(from, { text: messages[0] }, { quoted: mek });
    for (let i = 1; i < messages.length; i++) {
      await sleep(1000);
      await conn.sendMessage(from, {
        text: messages[i],
        edit: sent.key
      });
    }
  } catch (e) {
    reply(`❌ Error: ${e.message}`);
  }
});

// ── FIRE EMOJI TRIGGER ────────────────────────────────
cast({

    pattern: "🔥",

    desc: "Fire reaction",

    category: 'fun',

    react: "🔥"

}, async (conn, mek, m, { reply }) => {

    reply("Too hot to handle 😎🔥");

});

// ── SOLAR ART — hrt/joy/sad/angry... ──────────────────

// ── helpers ──────────────────────────────────────────────────────────
async function animate(conn, from, mek, frames, delay = 700) {
  const sent = await conn.sendMessage(from, { text: frames[0] }, { quoted: mek });
  for (let i = 1; i < frames.length; i++) {
    await sleep(delay);
    try {
      await conn.sendMessage(from, { text: frames[i], edit: sent.key });
    } catch {}
  }
}

// ── hrt ──────────────────────────────────────────────────────────────
cast({ pattern: 'hrt', alias: ['hearts'], desc: 'Animated hearts', category: 'fun', filename: __filename },
async (conn, mek, m, { from, q }) => {
  const emojis = ['💖','💗','💕','🩷','💛','💚','🩵','💙','💜','🖤','🤍','❤️‍🔥','💞','💓','💘','💝','♥️','❤️'];
  const txt = q || '#asta';
  await animate(conn, from, mek, emojis.map(e => `${txt.replace(/#\w+/g, e)}`), 800);
});

// ── joy ──────────────────────────────────────────────────────────────
cast({ pattern: 'joy', desc: 'Joyful emoji animation', category: 'fun', filename: __filename },
async (conn, mek, m, { from, q }) => {
  const emojis = ['😃','😄','😁','😊','😎','🥳','😸','😹','🌞','🌈'];
  const txt = q || '✨';
  await animate(conn, from, mek, emojis.map(e => `${txt} ${e}`), 500);
});

// ── sad ──────────────────────────────────────────────────────────────
cast({ pattern: 'sad', desc: 'Sad emoji animation', category: 'fun', filename: __filename },
async (conn, mek, m, { from, q }) => {
  const emojis = ['🥺','😟','😕','😖','😫','🙁','😩','😥','😓','😪','😢','😔','😞','😭','💔','😿'];
  const txt = q || '😞';
  await animate(conn, from, mek, emojis.map(e => `${txt} ${e}`), 700);
});

// ── angry ─────────────────────────────────────────────────────────────
cast({ pattern: 'angry', desc: 'Angry emoji animation', category: 'fun', filename: __filename },
async (conn, mek, m, { from, q }) => {
  const emojis = ['😡','😠','🤬','😤','😾','😡','😠','🤬','😤','😾'];
  const txt = q || '😤';
  await animate(conn, from, mek, emojis.map(e => `${txt} ${e}`), 500);
});

// ── shy ──────────────────────────────────────────────────────────────
cast({ pattern: 'shy', desc: 'Shy emoji animation', category: 'fun', filename: __filename },
async (conn, mek, m, { from, q }) => {
  const emojis = ['😳','😊','😶','🙈','🙊','😳','😊','😶','🙈','🙊'];
  const txt = q || '😊';
  await animate(conn, from, mek, emojis.map(e => `${txt} ${e}`), 500);
});

// ── conf ──────────────────────────────────────────────────────────────
cast({ pattern: 'conf', desc: 'Confused emoji animation', category: 'fun', filename: __filename },
async (conn, mek, m, { from, q }) => {
  const emojis = ['😕','😟','😵','🤔','😖','😲','😦','🤷','🤷‍♂️','🤷‍♀️'];
  const txt = q || '🤔';
  await animate(conn, from, mek, emojis.map(e => `${txt} ${e}`), 500);
});

// ── bored ─────────────────────────────────────────────────────────────
cast({ pattern: 'bored', desc: 'Bored emoji animation', category: 'fun', filename: __filename },
async (conn, mek, m, { from, q }) => {
  const emojis = ['😑','😐','😒','😴','😞','😔','😕','🙁','😩','😫','😖'];
  const txt = q || '😑';
  await animate(conn, from, mek, emojis.map(e => `${txt} ${e}`), 800);
});

// ── frust ─────────────────────────────────────────────────────────────
cast({ pattern: 'frust', desc: 'Frustrated emoji animation', category: 'fun', filename: __filename },
async (conn, mek, m, { from, q }) => {
  const emojis = ['😤','😡','😠','🤬','😖','😒','😩','😤','😡','😠'];
  const txt = q || '😤';
  await animate(conn, from, mek, emojis.map(e => `${txt} ${e}`), 800);
});

// ── luv ──────────────────────────────────────────────────────────────
cast({ pattern: 'luv', desc: 'Love emoji animation', category: 'fun', filename: __filename },
async (conn, mek, m, { from, q }) => {
  const emojis = ['❤️','💕','😻','🧡','💛','💚','💙','💜','🖤','❣️','💞','💓','💗','💖','💘','💝','💟','♥️','💌'];
  const txt = q || '✨';
  await animate(conn, from, mek, emojis.map(e => `${txt} ${e}`), 800);
});

// ── solar ─────────────────────────────────────────────────────────────
cast({ pattern: 'solar', desc: 'Solar system animation', category: 'fun', filename: __filename },
async (conn, mek, m, { from }) => {
  const frames = [
    '◼️◼️◼️◼️◼️\n◼️◼️◼️◼️☀\n◼️◼️🌎◼️◼️\n🌕◼️◼️◼️◼️\n◼️◼️◼️◼️◼️',
    '◼️◼️◼️◼️◼️\n🌕◼️◼️◼️◼️\n◼️◼️🌎◼️◼️\n◼️◼️◼️◼️☀\n◼️◼️◼️◼️◼️',
    '◼️🌕◼️◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️🌎◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️◼️☀◼️',
    '◼️◼️◼️🌕◼️\n◼️◼️◼️◼️◼️\n◼️◼️🌎◼️◼️\n◼️◼️◼️◼️◼️\n◼️☀◼️◼️◼️',
    '◼️◼️◼️◼️◼️\n◼️◼️◼️◼️🌕\n◼️◼️🌎◼️◼️\n☀◼️◼️◼️◼️\n◼️◼️◼️◼️◼️',
    '◼️◼️◼️◼️◼️\n☀◼️◼️◼️◼️\n◼️◼️🌎◼️◼️\n◼️◼️◼️◼️🌕\n◼️◼️◼️◼️◼️',
    '◼️☀◼️◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️🌎◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️◼️🌕◼️',
    '◼️◼️◼️☀◼️\n◼️◼️◼️◼️◼️\n◼️◼️🌎◼️◼️\n◼️◼️◼️◼️◼️\n◼️🌕◼️◼️◼️',
  ];
  const loop = [...frames, ...frames, ...frames];
  await animate(conn, from, mek, loop, 150);
});

// ── snake ─────────────────────────────────────────────────────────────
cast({ pattern: 'snake', desc: 'Snake animation', category: 'fun', filename: __filename },
async (conn, mek, m, { from }) => {
  const frames = [
    '◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️',
    '◻️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️',
    '◻️◻️◼️◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️',
    '◻️◻️◻️◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️',
    '‎◻️◻️◻️◻️◻️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️',
    '◻️◻️◻️◻️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️',
    '◻️◻️◻️◻️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◼️\n◼️◼️◼️◼️◼️',
    '◻️◻️◻️◻️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◼️',
    '◻️◻️◻️◻️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◻️',
    '◻️◻️◻️◻️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◻️◻️',
    '◻️◻️◻️◻️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◻️◻️◻️',
    '◻️◻️◻️◻️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◻️\n◼️◻️◻️◻️◻️',
    '◻️◻️◻️◻️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◻️\n◻️◻️◻️◻️◻️',
    '◻️◻️◻️◻️◻️\n◼️◼️◼️◼️◻️\n◼️◼️◼️◼️◻️\n◻️◼️◼️◼️◻️\n◻️◻️◻️◻️◻️',
    '◻️◻️◻️◻️◻️\n◼️◼️◼️◼️◻️\n◻️◼️◼️◼️◻️\n◻️◼️◼️◼️◻️\n◻️◻️◻️◻️◻️',
    '◻️◻️◻️◻️◻️\n◻️◼️◼️◼️◻️\n◻️◼️◼️◼️◻️\n◻️◼️◼️◼️◻️\n◻️◻️◻️◻️◻️',
    '◻️◻️◻️◻️◻️\n◻️◻️◼️◼️◻️\n◻️◼️◼️◼️◻️\n◻️◼️◼️◼️◻️\n◻️◻️◻️◻️◻️',
    '◻️◻️◻️◻️◻️\n◻️◻️◻️◼️◻️\n◻️◼️◼️◼️◻️\n◻️◼️◼️◼️◻️\n◻️◻️◻️◻️◻️',
    '◻️◻️◻️◻️◻️\n◻️◻️◻️◻️◻️\n◻️◼️◼️◼️◻️\n◻️◼️◼️◼️◻️\n◻️◻️◻️◻️◻️',
    '◻️◻️◻️◻️◻️\n◻️◻️◻️◻️◻️\n◻️◼️◼️◻️◻️\n◻️◼️◼️◼️◻️\n◻️◻️◻️◻️◻️',
    '◻️◻️◻️◻️◻️\n◻️◻️◻️◻️◻️\n◻️◼️◼️◻️◻️\n◻️◼️◼️◻️◻️\n◻️◻️◻️◻️◻️',
    '◻️◻️◻️◻️◻️\n◻️◻️◻️◻️◻️\n◻️◼️◼️◻️◻️\n◻️◼️◻️◻️◻️\n◻️◻️◻️◻️◻️',
    '◻️◻️◻️◻️◻️\n◻️◻️◻️◻️◻️\n◻️◼️◼️◻️◻️\n◻️◻️◻️◻️◻️\n◻️◻️◻️◻️◻️',
    '◻️◻️◻️◻️◻️\n◻️◻️◻️◻️◻️\n◻️◻️◼️◻️◻️\n◻️◻️◻️◻️◻️\n◻️◻️◻️◻️◻️',
    '◻️◻️◻️◻️◻️\n◻️◻️◻️◻️◻️\n◻️◻️◻️◻️◻️\n◻️◻️◻️◻️◻️\n◻️◻️◻️◻️◻️',
    '◻️◻️◻️◻️◻️\n◻️◼️◻️◼️◻️\n◻️◻️◻️◻️◻️\n◻️◼️◼️◼️◻️\n◻️◻️◻️◻️◻️',
  ];
  await animate(conn, from, mek, frames, 400);
});

// ── plane ─────────────────────────────────────────────────────────────
cast({ pattern: 'plane', desc: 'Plane flying animation', category: 'fun', filename: __filename },
async (conn, mek, m, { from }) => {
  const frames = Array.from({ length: 14 }, (_, i) => {
    const dash = '-'.repeat(i);
    const rest = '-'.repeat(13 - i);
    return `---------------\n${dash}✈${rest}\n---------------`;
  });
  await animate(conn, from, mek, frames, 700);
});

// ── moon ──────────────────────────────────────────────────────────────
cast({ pattern: 'moon', desc: 'Moon phase animation', category: 'fun', filename: __filename },
async (conn, mek, m, { from }) => {
  const phases = ['🌗','🌘','🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘','🌑','🌒','🌓','🌔','🌕','🌖'];
  await animate(conn, from, mek, phases.map(p => `${p} Moon Phases ${p}`), 700);
});

// ── TEDDY ─────────────────────────────────────────────

cast({
  pattern: 'teddy',
  desc: 'Cute teddy bear animation with hearts',
  category: 'fun',
  filename: __filename
}, async (conn, mek, m, { from }) => {
  try {
    const hearts = ['❤', '💕', '😻', '🧡', '💛', '💚', '💙', '💜', '🖤', '❣', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥', '💌', '🙂', '🤗', '😌', '😉', '😊', '🎊', '🎉', '🎁', '🎈'];
    const sent = await conn.sendMessage(from, { text: `(\\_/)\n( •.•)\n/>🤍` }, { quoted: mek });
    for (const heart of hearts) {
      await sleep(500);
      await conn.sendMessage(from, { text: `(\\_/)\n( •.•)\n/>${heart}`, edit: sent.key });
    }
  } catch (e) {
    await conn.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: mek });
  }
});

// ── LIVE TIME ─────────────────────────────────────────

cast({
  pattern: 'live',
  react: '⏰',
  desc: 'Show current live time and date',
  category: 'fun',
  filename: __filename
}, async (conn, mek, m, { from, reply }) => {
  try {
    const tz = config.TIMEZONE || 'Africa/Johannesburg';
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { timeZone: tz, hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const date = now.toLocaleDateString('en-ZA', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const hours = now.getHours();
    let wish = '🌙 Good Night';
    if (hours >= 5 && hours < 12) wish = '⛅ Good Morning';
    else if (hours >= 12 && hours < 17) wish = '🌞 Good Afternoon';
    else if (hours >= 17 && hours < 21) wish = '🌥️ Good Evening';

    const msg = `╭────────────────╮
│  *${wish}* 
│  ⏰ *Time:* ${time}
│  📅 *Date:* ${date}
│  🌍 *Zone:* ${tz}
╰────────────────╯`;
    await conn.sendMessage(from, { text: msg }, { quoted: mek });
  } catch (e) {
    reply(`❌ Error: ${e.message}`);
  }
});

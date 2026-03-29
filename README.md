# ✦ NEXUS-MD ✦

> A powerful, multi-purpose WhatsApp bot built on **Baileys 7.x** with SQLite storage, plugin-based architecture, and 390+ commands.

[![Version](https://img.shields.io/badge/version-3.0.1-blue)](https://github.com/Jupiterbold05/Platinum-v2.0)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

---

## 📋 Table of Contents

- [Features](#-features)
- [Commands](#-commands)
- [Requirements](#-requirements)
- [Quick Start](#-quick-start)
- [Environment Variables](#-environment-variables)
- [Deployment](#-deployment)
  - [Pterodactyl Panel](#pterodactyl-panel)
  - [Render](#render)
  - [Railway](#railway)
  - [Heroku](#heroku)
  - [VPS / Ubuntu](#vps--ubuntu)
  - [Docker](#docker)
- [Updating](#-updating)
- [Contributing](#-contributing)

---

## ✨ Features

- ⚡ **Fast** — Baileys 7.x with SQLite (no MongoDB required)
- 🔌 **Plugin-based** — 37 plugin files, easy to extend
- 💾 **Persistent settings** — everything survives restarts
- 🛡️ **Moderation** — antilink, antibot, antigroupmention, antidelete, antinewsletter, badwords, warnings
- 🎵 **Downloaders** — TikTok, Instagram, YouTube, Facebook, Spotify, SoundCloud, APK
- 🤖 **AI** — AI chat, image generation, sticker creation
- 🎮 **Games** — Word Chain Game, TicTacToe, economy system
- 📊 **Group management** — welcome/goodbye, filters, notes, reminders, activity tracking
- 🔤 **Font system** — 5 font styles applied globally via `setfont`
- 🔄 **Auto-update** — `:update now` downloads and installs latest from GitHub

---

## 📦 Commands

| Category | Commands |
|---|---|
| **Owner** | setbotname, setprefix, setmode, setalivemsg, setaliveimg, setfont, broadcast, restart, update |
| **Moderation** | antilink, antibot, antidelete, antigroupmention, antinewsletter, warn, kick, ban, blacklist, badwords |
| **Group** | welcome, goodbye, setwelcome, setgoodbye, tag, hidetag, tagall, mute, unmute, promote, demote, add |
| **Downloaders** | tt, igdl, yt, ytmp3, facebook, scdl, apk, play |
| **Info** | alive, ping, menu, uptime, getpp, stalk, botinfo |
| **Tools** | sticker, toimg, translate, tts, qrcode, getpp, remind |
| **AI** | ai, imagine |

> Run `:menu` in WhatsApp for the full command list.

---

## 🔧 Requirements

- **Node.js** v18 or higher
- **npm** v8+
- **ffmpeg** (for media conversion — included via `ffmpeg-static`)
- A WhatsApp account (not your main number — use a dedicated bot number)

---

## 🚀 Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/Jupiterbold05/Platinum-v2.0.git
cd Platinum-v2.0

# 2. Install dependencies
npm install

# 3. Copy and fill environment variables
cp .env.example config.env
nano config.env   # fill in SESSION_ID and OWNER_NUMBER

# 4. Start the bot
node index.js
```

---

## 🔑 Environment Variables

Copy `.env.example` to `config.env` and fill in the values:

| Variable | Required | Description |
|---|---|---|
| `SESSION_ID` | ✅ | Your WhatsApp session ID (from pairing) |
| `OWNER_NUMBER` | ✅ | Your WhatsApp number e.g. `2348012345678` |
| `BOT_NAME` | ❌ | Bot display name (default: NEXUS-MD) |
| `PREFIX` | ❌ | Command prefix (default: `:`) |
| `MODE` | ❌ | `public` or `private` (default: public) |
| `MONGO_URI` | ❌ | MongoDB URI (only needed for economy system) |
| `PAIR_SERVER_URL` | ❌ | Pairing server URL (default: https://repo-jjl7.onrender.com) |

---

## 🌐 Deployment

### Pterodactyl Panel

1. Create a **Node.js** egg on your panel
2. Upload your bot files via the Files tab
3. Set startup command to `node index.js`
4. Add environment variables in the Startup tab
5. Click **Start**

> Panel URL: your host's panel (e.g. `panel.skycastle.us`)

---

### Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com)

1. Go to [render.com](https://render.com) → New → Web Service
2. Connect your GitHub repo: `Jupiterbold05/Platinum-v2.0`
3. Set **Build Command**: `npm install`
4. Set **Start Command**: `node index.js`
5. Add environment variables in the Environment tab
6. Deploy

> Free tier available. Bot sleeps after 15 min inactivity — set `SELF_URL` to keep it alive.

---

### Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app)

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Select `Jupiterbold05/Platinum-v2.0`
3. Add environment variables in the Variables tab
4. Railway auto-detects Node.js and deploys

> Free tier: $5 credit/month. No sleep issues.

---

### Heroku

[![Deploy to Heroku](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com)

1. Go to [heroku.com](https://heroku.com) → New App
2. Connect GitHub repo or use Heroku CLI:

```bash
heroku login
heroku create your-app-name
git push heroku main
heroku config:set SESSION_ID=your_session OWNER_NUMBER=234xxx
heroku ps:scale web=1
```

> Paid only since Nov 2022 (minimum ~$5/month).

---

### VPS / Ubuntu

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 (process manager)
npm install -g pm2

# Clone and setup
git clone https://github.com/Jupiterbold05/Platinum-v2.0.git
cd Platinum-v2.0
npm install
cp .env.example config.env
nano config.env

# Start with PM2 (auto-restarts on crash)
pm2 start index.js --name nexus-md
pm2 save
pm2 startup
```

> Recommended VPS providers: [Contabo](https://contabo.com) · [Hetzner](https://hetzner.com) · [DigitalOcean](https://digitalocean.com) · [Vultr](https://vultr.com)

---

### Docker

```bash
# Build image
docker build -t nexus-md .

# Run container
docker run -d \
  --name nexus-md \
  --restart unless-stopped \
  -e SESSION_ID=your_session \
  -e OWNER_NUMBER=2348012345678 \
  -v $(pwd)/data:/app/data \
  nexus-md
```

Or with Docker Compose:

```bash
cp .env.example .env
nano .env
docker-compose up -d
```

---

## 🔄 Updating

**Auto-update via WhatsApp:**
```
:update        — check for updates
:update now    — download and install latest version
```

**Manual update:**
```bash
git pull origin main
npm install
```

Then bump `data/version.json` on GitHub with your new version number and changelog.

---

## 🤝 Contributing

1. Fork the repo
2. Create a branch: `git checkout -b feature/my-feature`
3. Commit: `git commit -m "Add my feature"`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

---

## 📞 Support

- **GitHub Issues**: [github.com/Jupiterbold05/Platinum-v2.0/issues](https://github.com/Jupiterbold05/Platinum-v2.0/issues)
- **WhatsApp Channel**: [Follow NEXUS-MD](https://whatsapp.com/channel/0029Vb7DtMV9Bb5vhQyH1U05) — updates, news and announcements

---

<p align="center">Made with ❤️ by Jupiter · NEXUS-MD v3.0.1</p>

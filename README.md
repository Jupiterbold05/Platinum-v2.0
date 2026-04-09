---
title: NEXUS-MD WhatsApp Bot
emoji: 🤖
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# NEXUS-MD WhatsApp Bot

A feature-rich WhatsApp bot built with [Baileys](https://github.com/WhiskeySockets/Baileys) and Node.js.

## Deploy on HuggingFace Spaces

This Space uses the **Docker** SDK. The bot will start automatically once environment variables are configured.

## Required Environment Variables

Set these in your Space's **Settings → Variables and secrets**:

| Variable | Description | Required |
|---|---|---|
| `SESSION_ID` | Your Baileys session ID (from pairing) | ✅ |
| `OWNER_NUMBER` | Your WhatsApp number with country code (e.g. `2348012345678`) | ✅ |
| `OWNER_NAME` | Your display name | ✅ |
| `BOT_NAME` | Bot display name | ✅ |
| `PREFIX` | Command prefix (default `:`) | ✅ |
| `MODE` | `public` or `private` | ✅ |
| `MONGO_URI` | MongoDB connection string | Optional |
| `SUPABASE_URL` | Supabase project URL | Optional |
| `SUPABASE_KEY` | Supabase anon/public key | Optional |
| `TIMEZONE` | e.g. `Africa/Johannesburg` | Optional |
| `STICKER_PACK` | Sticker pack name | Optional |
| `STICKER_AUTHOR` | Sticker author name | Optional |

## Getting a Session ID

1. Visit your pairing server or run locally with `node index.js`
2. Scan the QR code or enter your number for pairing
3. Copy the generated `SESSION_ID` and add it to your Space secrets

## Notes

- The bot runs on port **7860** (HuggingFace default)
- Data is stored in `/home/user/app/data/` — note that HF Spaces storage is **ephemeral** unless you use persistent storage or an external DB (MongoDB/Supabase recommended)
- Economy XP and leveling still works silently — level-up events are tracked but no group announcements are sent

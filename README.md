# 📬 Slack Daily Digest Bot

Scrapes your client Slack channels, translates Norwegian → English, summarises tasks and follow-ups using Claude, then posts a daily digest to your VA's channel.

---

## 🚀 Setup (15 minutes)

### 1. Create a Slack App

1. Go to https://api.slack.com/apps → **Create New App** → From scratch
2. Name it `Daily Digest Bot`, pick your workspace
3. Go to **OAuth & Permissions** → add these **Bot Token Scopes**:
   - `channels:history` — read public channel messages
   - `channels:read` — get channel names
   - `groups:history` — read private channel messages (if needed)
   - `groups:read`
   - `users:read` — resolve user names
   - `chat:write` — post the digest
4. Click **Install to Workspace** → copy the **Bot User OAuth Token** (`xoxb-...`)
5. **Invite the bot** to every channel you want it to read + the digest channel:
   `/invite @Daily Digest Bot`

### 2. Get Channel IDs

In Slack, right-click any channel → **Copy link**. The ID is the last segment:
`https://app.slack.com/client/T.../`**`C0123ABCDEF`**

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your tokens and channel IDs
```

### 4. Install & run

```bash
npm install

# Test it right now (runs once immediately):
node index.js --now

# Start the scheduler (runs daily at 08:00 Oslo time):
npm start
```

---

## ☁️ Deploy (pick one)

### Railway (easiest, free tier available)
1. Push this folder to a GitHub repo
2. New project on https://railway.app → Deploy from GitHub
3. Add all env vars under **Variables**
4. Done — Railway keeps it running 24/7

### Render
1. New **Background Worker** on https://render.com
2. Connect your repo, set env vars
3. Start command: `npm start`

### VPS / your own server
```bash
npm install -g pm2
pm2 start index.js --name digest-bot
pm2 save && pm2 startup
```

---

## 📋 What the digest looks like

```
📬 Daily Client Digest — Monday, 2 June 2026
Covering the last 24 hours across 3 channel(s)

━━━━━━━━━━━━━━━━━━━━━━
#client-acme
━━━━━━━━━━━━━━━━━━━━━━

## 📋 Asana Tasks to Create
- **Task:** Send revised proposal PDF
  - Details: Client asked for updated pricing after the call
  - Who: Acme / Lars
  - Due: Wednesday

## 🔔 Follow-Ups Required
- Check if Acme received the invoice from last week

## ❓ Open Questions
- Do they want onboarding in week 24 or 25?

## 📝 General Summary
Discussion mainly around the revised proposal and onboarding timing...
```

---

## ⚙️ Customisation

| Env var | Default | Description |
|---|---|---|
| `CRON_SCHEDULE` | `0 6 * * *` | When to run (UTC). `0 6 * * 1-5` = weekdays only |
| `LOOKBACK_HOURS` | `24` | How far back to read messages |

---

## 🔒 Required Slack Scopes Summary

| Scope | Why |
|---|---|
| `channels:history` | Read public channel messages |
| `channels:read` | Resolve channel names |
| `groups:history` | Read private channels |
| `groups:read` | Resolve private channel names |
| `users:read` | Show real names instead of user IDs |
| `chat:write` | Post the digest |

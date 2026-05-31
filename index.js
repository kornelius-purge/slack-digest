import cron from "node-cron";
import fetch from "node-fetch";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CONFIG = {
  // Slack tokens & channels
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  // List of channel IDs to scrape (e.g. "C0123ABCDEF")
  SOURCE_CHANNEL_IDS: process.env.SOURCE_CHANNEL_IDS
    ? process.env.SOURCE_CHANNEL_IDS.split(",").map((s) => s.trim())
    : [],
  // Channel where the VA receives the daily digest
  DIGEST_CHANNEL_ID: process.env.DIGEST_CHANNEL_ID,

  // Anthropic
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,

  // Cron: default 08:00 Oslo time (UTC+2 in summer → "0 6 * * *")
  // Adjust the UTC offset for winter (UTC+1 → "0 7 * * *")
  CRON_SCHEDULE: process.env.CRON_SCHEDULE || "0 6 * * *",

  // How many hours back to look (default: last 24 h)
  LOOKBACK_HOURS: parseInt(process.env.LOOKBACK_HOURS || "24", 10),
};

// ─── SLACK HELPERS ──────────────────────────────────────────────────────────

async function slackGet(method, params = {}) {
  const url = new URL(`https://slack.com/api/${method}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${CONFIG.SLACK_BOT_TOKEN}` },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${method} error: ${data.error}`);
  return data;
}

async function getChannelName(channelId) {
  try {
    const data = await slackGet("conversations.info", { channel: channelId });
    return data.channel.name || channelId;
  } catch {
    return channelId;
  }
}

async function getUserName(userId) {
  try {
    const data = await slackGet("users.info", { user: userId });
    return data.user.real_name || data.user.name || userId;
  } catch {
    return userId;
  }
}

async function fetchRecentMessages(channelId, hours) {
  const oldest = Math.floor(Date.now() / 1000) - hours * 3600;
  let messages = [];
  let cursor;

  do {
    const params = { channel: channelId, oldest, limit: 200 };
    if (cursor) params.cursor = cursor;
    const data = await slackGet("conversations.history", params);
    messages = messages.concat(data.messages || []);
    cursor = data.response_metadata?.next_cursor;
  } while (cursor);

  // Resolve user names
  const userCache = {};
  const resolved = await Promise.all(
    messages
      .filter((m) => m.type === "message" && m.text && !m.subtype)
      .map(async (m) => {
        if (!userCache[m.user]) {
          userCache[m.user] = await getUserName(m.user);
        }
        const ts = new Date(parseFloat(m.ts) * 1000).toLocaleTimeString(
          "en-GB",
          { hour: "2-digit", minute: "2-digit" }
        );
        return `[${ts}] ${userCache[m.user]}: ${m.text}`;
      })
  );

  return resolved.reverse(); // chronological order
}

// ─── CLAUDE SUMMARISER ──────────────────────────────────────────────────────

async function summariseWithClaude(channelName, messages) {
  if (messages.length === 0) return null;

  const transcript = messages.join("\n");

  const prompt = `You are a business assistant helping a VA stay on top of all team activity.

Below is a Slack conversation from the channel "#${channelName}" from the past 24 hours.
The messages may be in Norwegian or English — translate any Norwegian to English first, then analyse.
Be concise. No fluff. Produce this exact structure:

## ✅ Asana Tasks
- [ ] Task name — context in one line (Person, Due: date or TBD)

## 🔔 Follow-Ups
- One line per item (who needs to follow up with whom)

## ❓ Open Questions / Decisions Needed
- One line per item

## 📝 Summary
Max 2 sentences covering what was discussed.
---
TRANSCRIPT:
---
TRANSCRIPT:
${transcript}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CONFIG.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(`Claude error: ${data.error.message}`);
  return data.content[0].text;
}

// ─── SLACK POSTER ───────────────────────────────────────────────────────────

async function postDigest(summaries) {
  const date = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const header = `*📬 Daily Client Digest — ${date}*\n_Covering the last ${CONFIG.LOOKBACK_HOURS} hours across ${summaries.length} channel(s)_\n\n`;

  const body = summaries
    .map(
      ({ channelName, summary }) =>
        `━━━━━━━━━━━━━━━━━━━━━━\n*#${channelName}*\n━━━━━━━━━━━━━━━━━━━━━━\n${summary}`
    )
    .join("\n\n");

  const fullText = header + body;

  // Slack has a 4000-char limit per block — split if needed
  const chunks = [];
  for (let i = 0; i < fullText.length; i += 3900) {
    chunks.push(fullText.slice(i, i + 3900));
  }

  for (const chunk of chunks) {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CONFIG.SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: CONFIG.DIGEST_CHANNEL_ID,
        text: chunk,
        mrkdwn: true,
      }),
    });
  }

  console.log(`✅ Digest posted to ${CONFIG.DIGEST_CHANNEL_ID}`);
}

// ─── MAIN JOB ───────────────────────────────────────────────────────────────

async function runDigest() {
  console.log(`🔍 Running digest at ${new Date().toISOString()}`);

  if (!CONFIG.SOURCE_CHANNEL_IDS.length) {
    console.error("❌ No SOURCE_CHANNEL_IDS configured.");
    return;
  }

  const summaries = [];

  for (const channelId of CONFIG.SOURCE_CHANNEL_IDS) {
    try {
      const channelName = await getChannelName(channelId);
      console.log(
        `📥 Fetching #${channelName} (last ${CONFIG.LOOKBACK_HOURS}h)...`
      );
      const messages = await fetchRecentMessages(
        channelId,
        CONFIG.LOOKBACK_HOURS
      );

      if (messages.length === 0) {
        console.log(`   ↳ No messages found, skipping.`);
        continue;
      }

      console.log(`   ↳ ${messages.length} messages — summarising...`);
      const summary = await summariseWithClaude(channelName, messages);
      if (summary) summaries.push({ channelName, summary });
    } catch (err) {
      console.error(`❌ Error processing ${channelId}:`, err.message);
    }
  }

  if (summaries.length === 0) {
    console.log("📭 No activity found across any channels. No digest posted.");
    return;
  }

  await postDigest(summaries);
}

// ─── SCHEDULER ──────────────────────────────────────────────────────────────

console.log(`🤖 Slack Digest Bot starting...`);
console.log(`   Channels : ${CONFIG.SOURCE_CHANNEL_IDS.join(", ") || "NONE"}`);
console.log(`   Digest → : ${CONFIG.DIGEST_CHANNEL_ID || "NONE"}`);
console.log(`   Schedule : ${CONFIG.CRON_SCHEDULE}`);
console.log(`   Lookback : ${CONFIG.LOOKBACK_HOURS}h`);

// Run once immediately on start (useful for testing)
if (process.argv.includes("--now")) {
  runDigest().catch(console.error);
} else {
  cron.schedule(CONFIG.CRON_SCHEDULE, runDigest, { timezone: "Europe/Oslo" });
  console.log(`⏰ Scheduled. Waiting for next run...`);
}

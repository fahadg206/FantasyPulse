// pages/api/sendPush.js
//
// Sends real Expo push notifications - the one step that has to happen
// server-side rather than straight from a client, even though this app's
// existing trust model already lets any signed-in client write Boogie's
// posts directly. Expo's push relay (https://exp.host) needs no API key
// for the managed-workflow push tokens this app registers (see the mobile
// app's lib/pushNotifications.ts), so this route is a thin, unauthenticated
// pass-through - the real gatekeeping is that a caller needs a real
// person's real Expo push token to reach them at all, and those only ever
// come from that person's own device registering for notifications.
//
// Batches into groups of 100, Expo's own documented limit per request.

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 100;

function isValidExpoPushToken(token) {
  return typeof token === "string" && /^(Expo|Exponent)PushToken\[.+\]$/.test(token);
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { tokens, title, body, data } = req.body || {};

  if (!Array.isArray(tokens) || tokens.length === 0) {
    res.status(400).json({ error: "tokens must be a non-empty array" });
    return;
  }
  if (!title || !body) {
    res.status(400).json({ error: "title and body are required" });
    return;
  }

  const validTokens = [...new Set(tokens)].filter(isValidExpoPushToken);
  if (validTokens.length === 0) {
    res.status(200).json({ sent: 0, skipped: tokens.length, results: [] });
    return;
  }

  const messages = validTokens.map((to) => ({
    to,
    title,
    body,
    sound: "default",
    ...(data ? { data } : {}),
  }));

  try {
    const batches = chunk(messages, BATCH_SIZE);
    const results = [];
    for (const batch of batches) {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(batch),
      });
      const json = await response.json();
      results.push(...(json.data || []));
    }

    res.status(200).json({ sent: validTokens.length, skipped: tokens.length - validTokens.length, results });
  } catch (error) {
    console.error("Error sending push notifications:", error);
    res.status(500).json({ error: "Failed to send push notifications" });
  }
}

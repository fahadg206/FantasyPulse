// pages/api/sendUsernameRecoveryOtp.js
//
// Step 1 of "forgot your username, recover it with your phone number":
// sends a 6-digit SMS code via Twilio's REST API, called directly rather
// than pulling in the twilio npm package - verified against Twilio's own
// published API contract (endpoint, Basic Auth, form-encoded body) before
// writing this, not assumed.
//
// Deliberately does NOT reveal whether a phone number is registered: the
// response is the same {ok:true} whether or not an account was found,
// unless the request is rate-limited (which is about this specific send
// attempt, not about registration status).
import { doc, getDoc, setDoc } from "firebase/firestore/lite";
import { db, authReady } from "../../app/firebase";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute

function normalizePhoneNumber(raw) {
  const digits = (raw || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  // Assumes a US number when no country code is given - this app's
  // audience is US-based fantasy football leagues.
  const bare = digits.replace(/\D/g, "");
  if (bare.length === 10) return `+1${bare}`;
  if (bare.length === 11 && bare.startsWith("1")) return `+${bare}`;
  return `+${bare}`;
}

async function sendSms(to, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    throw new Error(
      "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER must be set"
    );
  }

  const params = new URLSearchParams({ To: to, From: fromNumber, Body: body });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Twilio send failed (${res.status}): ${errText.slice(0, 300)}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { phoneNumber } = req.body || {};
  if (!phoneNumber) {
    return res.status(400).json({ message: "phoneNumber is required" });
  }

  const normalized = normalizePhoneNumber(phoneNumber);

  try {
    await authReady;

    const phoneLookupSnap = await getDoc(doc(db, "phoneNumbers", normalized));
    if (!phoneLookupSnap.exists()) {
      // Nothing registered under this number - silent no-op, same response
      // as a real send, so the endpoint doesn't reveal registration status.
      return res.status(200).json({ ok: true });
    }

    const existingOtpSnap = await getDoc(doc(db, "otpCodes", normalized));
    if (existingOtpSnap.exists()) {
      const existing = existingOtpSnap.data();
      const sentAt = new Date(existing.createdAt).getTime();
      if (Date.now() - sentAt < RESEND_COOLDOWN_MS) {
        return res
          .status(429)
          .json({ message: "Please wait a bit before requesting another code." });
      }
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const now = new Date();
    await setDoc(doc(db, "otpCodes", normalized), {
      code,
      attempts: 0,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + OTP_TTL_MS).toISOString(),
    });

    await sendSms(
      normalized,
      `Your Fantasy Pulse verification code is ${code}. It expires in 10 minutes.`
    );

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Error sending username recovery OTP:", error);
    return res.status(500).json({ message: "Failed to send verification code" });
  }
}

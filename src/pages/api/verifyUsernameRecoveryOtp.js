// pages/api/verifyUsernameRecoveryOtp.js
//
// Step 2 of "forgot your username, recover it with your phone number":
// checks the code sent by sendUsernameRecoveryOtp.js and, if it matches,
// reveals the username tied to that phone number. Single-use (the OTP doc
// is deleted on success) with a 5-attempt limit before it has to be
// re-requested.
import { doc, getDoc, deleteDoc, updateDoc } from "firebase/firestore/lite";
import { db, authReady } from "../../app/firebase";

const MAX_ATTEMPTS = 5;

function normalizePhoneNumber(raw) {
  const digits = (raw || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  const bare = digits.replace(/\D/g, "");
  if (bare.length === 10) return `+1${bare}`;
  if (bare.length === 11 && bare.startsWith("1")) return `+${bare}`;
  return `+${bare}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { phoneNumber, code } = req.body || {};
  if (!phoneNumber || !code) {
    return res.status(400).json({ message: "phoneNumber and code are required" });
  }

  const normalized = normalizePhoneNumber(phoneNumber);

  try {
    await authReady;

    const otpRef = doc(db, "otpCodes", normalized);
    const otpSnap = await getDoc(otpRef);
    if (!otpSnap.exists()) {
      return res
        .status(400)
        .json({ message: "That code has expired or wasn't found. Request a new one." });
    }

    const otp = otpSnap.data();

    if (new Date(otp.expiresAt).getTime() < Date.now()) {
      await deleteDoc(otpRef);
      return res.status(400).json({ message: "That code has expired. Request a new one." });
    }

    if ((otp.attempts || 0) >= MAX_ATTEMPTS) {
      await deleteDoc(otpRef);
      return res
        .status(429)
        .json({ message: "Too many incorrect attempts. Request a new code." });
    }

    if (String(code).trim() !== otp.code) {
      // firestore/lite has no increment() field transform (that's a full
      // firestore-only export) - a plain read-then-write does the same
      // thing here, where a single request already has the current count.
      await updateDoc(otpRef, { attempts: (otp.attempts || 0) + 1 });
      return res.status(400).json({ message: "Incorrect code." });
    }

    await deleteDoc(otpRef);

    const phoneLookupSnap = await getDoc(doc(db, "phoneNumbers", normalized));
    if (!phoneLookupSnap.exists()) {
      return res.status(404).json({ message: "No account found for that phone number." });
    }
    const { uid } = phoneLookupSnap.data();

    const profileSnap = await getDoc(doc(db, "profiles", uid));
    if (!profileSnap.exists()) {
      return res.status(404).json({ message: "Account found, but its profile is missing." });
    }

    return res.status(200).json({ username: profileSnap.data().username });
  } catch (error) {
    console.error("Error verifying username recovery OTP:", error);
    return res.status(500).json({ message: "Failed to verify code" });
  }
}

import {
  collection,
  addDoc,
  doc,
  updateDoc,
  query,
  where,
  orderBy,
  limit as fsLimit,
  getDocs,
  writeBatch,
} from "firebase/firestore/lite";
import { db } from "./firebase";

// An in-app notification center - the real, fully-working piece of
// "push notifications" this app can actually ship right now. True OS-level
// push (a notification arriving while the app's fully closed, on someone
// else's phone) needs an EAS project tied to a real Expo account and a
// dev/production build - this repo has neither (no eas.json, no
// app.json extra.eas.projectId, no bundle identifiers set; it's only ever
// been run through plain `expo start`), and setting that up needs an
// Expo account login this environment has no access to. So this is the
// honest, deliverable version: written the instant the triggering action
// happens (a reply, a follow, a like), read by a bell icon with an unread
// badge - the same information a push notification would carry, just
// requiring the app to be open to see it arrive, rather than a false
// "push notifications are on" claim this repo can't actually back up yet.

export type NotificationType = "reply" | "follow" | "like" | "repost";

export interface AppNotification {
  id: string;
  recipientUid: string;
  type: NotificationType;
  actorUid: string;
  actorDisplayName: string;
  actorUsername: string;
  actorAvatar?: string;
  /** the post this notification is about (reply/like/repost) - absent for "follow" */
  postId?: string;
  postTextPreview?: string;
  createdAtMs: number;
  read: boolean;
}

interface NotifyInput {
  recipientUid: string;
  type: NotificationType;
  actorUid: string;
  actorDisplayName: string;
  actorUsername: string;
  actorAvatar?: string;
  postId?: string;
  postTextPreview?: string;
}

/**
 * Writes one notification - a no-op if the recipient is the actor
 * themselves (liking/replying to/following your own post shouldn't notify
 * you) so every call site can call this unconditionally without its own
 * self-notification check.
 */
export async function notify(input: NotifyInput): Promise<void> {
  if (input.recipientUid === input.actorUid) return;
  try {
    await addDoc(collection(db, "notifications"), {
      recipientUid: input.recipientUid,
      type: input.type,
      actorUid: input.actorUid,
      actorDisplayName: input.actorDisplayName,
      actorUsername: input.actorUsername,
      actorAvatar: input.actorAvatar ?? null,
      postId: input.postId ?? null,
      postTextPreview: input.postTextPreview ?? null,
      createdAtMs: Date.now(),
      read: false,
    });
  } catch (error) {
    // Best-effort - the action that triggered this (the reply/like/follow
    // itself) has already succeeded by the time this runs, so a failed
    // notification write shouldn't surface as an error to whoever just
    // liked a post.
    console.error("Error writing notification:", error);
  }
}

export async function getNotifications(uid: string, limitCount = 50): Promise<AppNotification[]> {
  const q = query(
    collection(db, "notifications"),
    where("recipientUid", "==", uid),
    orderBy("createdAtMs", "desc"),
    fsLimit(limitCount)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AppNotification, "id">) }));
}

export async function getUnreadNotificationCount(uid: string): Promise<number> {
  const q = query(collection(db, "notifications"), where("recipientUid", "==", uid), where("read", "==", false));
  const snap = await getDocs(q);
  return snap.size;
}

export async function markNotificationRead(id: string): Promise<void> {
  await updateDoc(doc(db, "notifications", id), { read: true });
}

/** marks every currently-unread notification for this user read in one batch - called when the Notifications screen opens */
export async function markAllNotificationsRead(uid: string): Promise<void> {
  const q = query(collection(db, "notifications"), where("recipientUid", "==", uid), where("read", "==", false));
  const snap = await getDocs(q);
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.update(d.ref, { read: true }));
  await batch.commit();
}

import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit as fsLimit,
  getDocs,
  arrayRemove,
} from "firebase/firestore/lite";
import { db } from "./firebase";

// Direct messages - one conversation per pair of users, exactly like X's
// DMs (no group chats, no request/accept split - scope kept to the core
// feature). A conversation's id is deterministic (the two uids, sorted
// and joined) so starting one is idempotent - no query needed to check
// "does a conversation already exist" before creating it.

export interface ConversationParticipant {
  displayName: string;
  username: string;
  avatar?: string;
}

export interface Conversation {
  id: string;
  participants: string[];
  participantProfiles: Record<string, ConversationParticipant>;
  lastMessageText: string;
  lastMessageAtMs: number;
  lastMessageSenderUid: string;
  /** uids who have NOT yet read the latest message - simpler than a per-user read timestamp, and all a conversation list/badge needs */
  unreadBy: string[];
}

export interface Message {
  id: string;
  conversationId: string;
  senderUid: string;
  text: string;
  imageUrl?: string;
  createdAtMs: number;
}

function conversationId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join("_");
}

/** the other participant in a 2-person conversation */
export function otherParticipant(conversation: Conversation, myUid: string): string | undefined {
  return conversation.participants.find((p) => p !== myUid);
}

/** creates the conversation doc if it doesn't exist yet (idempotent - safe to call every time "Message" is tapped), returns its id */
export async function getOrCreateConversation(
  me: { uid: string; displayName: string; username: string; avatar?: string },
  other: { uid: string; displayName: string; username: string; avatar?: string }
): Promise<string> {
  const id = conversationId(me.uid, other.uid);
  const ref = doc(db, "conversations", id);
  const existing = await getDoc(ref);
  if (existing.exists()) return id;

  await setDoc(ref, {
    participants: [me.uid, other.uid].sort(),
    participantProfiles: {
      [me.uid]: { displayName: me.displayName, username: me.username, avatar: me.avatar ?? null },
      [other.uid]: { displayName: other.displayName, username: other.username, avatar: other.avatar ?? null },
    },
    lastMessageText: "",
    lastMessageAtMs: Date.now(),
    lastMessageSenderUid: me.uid,
    unreadBy: [],
  });
  return id;
}

export async function getConversations(uid: string): Promise<Conversation[]> {
  const q = query(
    collection(db, "conversations"),
    where("participants", "array-contains", uid),
    orderBy("lastMessageAtMs", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Conversation, "id">) }));
}

export async function getUnreadConversationCount(uid: string): Promise<number> {
  const conversations = await getConversations(uid);
  return conversations.filter((c) => c.unreadBy.includes(uid)).length;
}

export async function getMessages(conversationId: string, limitCount = 100): Promise<Message[]> {
  const q = query(
    collection(db, "messages"),
    where("conversationId", "==", conversationId),
    orderBy("createdAtMs", "asc"),
    fsLimit(limitCount)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Message, "id">) }));
}

export async function sendMessage(
  conversation: Pick<Conversation, "id" | "participants">,
  senderUid: string,
  text: string,
  imageUrl?: string
): Promise<Message> {
  const trimmed = text.trim();
  if (!trimmed && !imageUrl) throw new Error("Say something first.");

  const createdAtMs = Date.now();
  const data = {
    conversationId: conversation.id,
    // Denormalized onto every message so Firestore rules can check
    // membership without a cross-document get() per message read.
    participants: conversation.participants,
    senderUid,
    text: trimmed,
    imageUrl: imageUrl ?? null,
    createdAtMs,
  };
  const ref = await addDoc(collection(db, "messages"), data);

  const recipientUid = conversation.participants.find((p) => p !== senderUid);
  await updateDoc(doc(db, "conversations", conversation.id), {
    lastMessageText: trimmed || "📷 Photo",
    lastMessageAtMs: createdAtMs,
    lastMessageSenderUid: senderUid,
    unreadBy: recipientUid ? [recipientUid] : [],
  });

  return { id: ref.id, ...data, imageUrl };
}

/** removes this uid from the conversation's unreadBy list - called when its message screen opens */
export async function markConversationRead(conversationId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, "conversations", conversationId), { unreadBy: arrayRemove(uid) });
}

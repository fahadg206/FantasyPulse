import {
  collection,
  addDoc,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit as fsLimit,
  getDocs,
} from "firebase/firestore/lite";
import { db } from "./firebase";

// One unified model for both "comment on a specific matchup/trade" and
// "post to the public feed": a post with no target is a standalone feed
// post (a tweet); a post with a target is both a comment on that
// matchup/trade AND an entry in the public feed, tagged with what it's
// about - the same way replying to something on Twitter is still a tweet
// that shows up in the timeline. One system instead of two.

export interface Post {
  id: string;
  authorUid: string;
  authorUsername: string;
  authorDisplayName: string;
  authorAvatar?: string;
  text: string;
  createdAt: string;
  createdAtMs: number;
  leagueId?: string;
  targetType?: "matchup" | "trade";
  targetId?: string;
  targetLabel?: string;
  likeCount: number;
  replyCount: number;
  repostCount: number;
}

export interface CreatePostInput {
  authorUid: string;
  authorUsername: string;
  authorDisplayName: string;
  authorAvatar?: string;
  text: string;
  leagueId?: string;
  targetType?: "matchup" | "trade";
  targetId?: string;
  targetLabel?: string;
}

const MAX_POST_LENGTH = 280;

export function validatePostText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "Say something first.";
  if (trimmed.length > MAX_POST_LENGTH) return `Keep it under ${MAX_POST_LENGTH} characters.`;
  return null;
}

export async function createPost(input: CreatePostInput): Promise<Post> {
  const text = input.text.trim();
  const validationError = validatePostText(text);
  if (validationError) throw new Error(validationError);

  const now = new Date();
  const data = {
    authorUid: input.authorUid,
    authorUsername: input.authorUsername,
    authorDisplayName: input.authorDisplayName,
    authorAvatar: input.authorAvatar ?? null,
    text,
    createdAt: now.toISOString(),
    createdAtMs: now.getTime(),
    leagueId: input.leagueId ?? null,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    targetLabel: input.targetLabel ?? null,
    likeCount: 0,
    replyCount: 0,
    repostCount: 0,
  };

  const ref = await addDoc(collection(db, "posts"), data);

  return { id: ref.id, ...data, authorAvatar: input.authorAvatar, leagueId: input.leagueId, targetType: input.targetType, targetId: input.targetId, targetLabel: input.targetLabel };
}

/** the public feed - every post, newest first, across every league */
export async function getFeedPosts(limitCount = 30): Promise<Post[]> {
  const q = query(collection(db, "posts"), orderBy("createdAtMs", "desc"), fsLimit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }));
}

/** comments attached to one specific matchup or trade, oldest first (reading top to bottom like a thread) */
export async function getPostsForTarget(
  targetType: "matchup" | "trade",
  targetId: string
): Promise<Post[]> {
  const q = query(
    collection(db, "posts"),
    where("targetType", "==", targetType),
    where("targetId", "==", targetId),
    orderBy("createdAtMs", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }));
}

function likeDocId(postId: string, uid: string): string {
  return `${postId}_${uid}`;
}

export async function isPostLiked(postId: string, uid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "postLikes", likeDocId(postId, uid)));
  return snap.exists();
}

/** toggles a like and returns the new liked state - best-effort count update, not a transaction, since a small race on a like count isn't worth the complexity here */
export async function toggleLike(postId: string, uid: string): Promise<boolean> {
  const likeRef = doc(db, "postLikes", likeDocId(postId, uid));
  const postRef = doc(db, "posts", postId);
  const [likeSnap, postSnap] = await Promise.all([getDoc(likeRef), getDoc(postRef)]);
  const currentCount = (postSnap.data()?.likeCount as number) ?? 0;

  if (likeSnap.exists()) {
    await deleteDoc(likeRef);
    await updateDoc(postRef, { likeCount: Math.max(0, currentCount - 1) });
    return false;
  }

  await setDoc(likeRef, { postId, uid, createdAt: new Date().toISOString() });
  await updateDoc(postRef, { likeCount: currentCount + 1 });
  return true;
}

function repostDocId(postId: string, uid: string): string {
  return `${postId}_${uid}`;
}

export async function isPostReposted(postId: string, uid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "postReposts", repostDocId(postId, uid)));
  return snap.exists();
}

/** a simple count-only repost (no quote/duplicate-post support yet), same toggle pattern as likes */
export async function toggleRepost(postId: string, uid: string): Promise<boolean> {
  const repostRef = doc(db, "postReposts", repostDocId(postId, uid));
  const postRef = doc(db, "posts", postId);
  const [repostSnap, postSnap] = await Promise.all([getDoc(repostRef), getDoc(postRef)]);
  const currentCount = (postSnap.data()?.repostCount as number) ?? 0;

  if (repostSnap.exists()) {
    await deleteDoc(repostRef);
    await updateDoc(postRef, { repostCount: Math.max(0, currentCount - 1) });
    return false;
  }

  await setDoc(repostRef, { postId, uid, createdAt: new Date().toISOString() });
  await updateDoc(postRef, { repostCount: currentCount + 1 });
  return true;
}

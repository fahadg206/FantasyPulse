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

// A "post sized" scoreboard, embedded in a post the same way a tweet embeds
// a card - two teams, their scores, and whether it's final, rendered by
// PostCard as a compact score strip instead of plain text.
export interface MatchupCard {
  leagueId: string;
  week: number;
  team1Name: string;
  team1Score: number;
  team1Avatar?: string;
  team2Name: string;
  team2Score: number;
  team2Avatar?: string;
  isFinal: boolean;
}

export interface Post {
  id: string;
  authorUid: string;
  authorUsername: string;
  authorDisplayName: string;
  authorAvatar?: string;
  text: string;
  imageUrl?: string;
  matchupCard?: MatchupCard;
  createdAt: string;
  createdAtMs: number;
  leagueId?: string;
  targetType?: "matchup" | "trade" | "waiver";
  targetId?: string;
  targetLabel?: string;
  /** set when this post is a reply to another post - see getReplies/getPost */
  parentPostId?: string;
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
  imageUrl?: string;
  leagueId?: string;
  targetType?: "matchup" | "trade" | "waiver";
  targetId?: string;
  targetLabel?: string;
  parentPostId?: string;
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
    imageUrl: input.imageUrl ?? null,
    createdAt: now.toISOString(),
    createdAtMs: now.getTime(),
    leagueId: input.leagueId ?? null,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    targetLabel: input.targetLabel ?? null,
    parentPostId: input.parentPostId ?? null,
    likeCount: 0,
    replyCount: 0,
    repostCount: 0,
  };

  const ref = await addDoc(collection(db, "posts"), data);

  if (input.parentPostId) {
    const parentRef = doc(db, "posts", input.parentPostId);
    const parentSnap = await getDoc(parentRef);
    const currentReplyCount = (parentSnap.data()?.replyCount as number) ?? 0;
    await updateDoc(parentRef, { replyCount: currentReplyCount + 1 }).catch((error) =>
      console.error("Error updating parent reply count:", error)
    );
  }

  return {
    id: ref.id,
    ...data,
    authorAvatar: input.authorAvatar,
    imageUrl: input.imageUrl,
    leagueId: input.leagueId,
    targetType: input.targetType,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    parentPostId: input.parentPostId,
  };
}

/** a single post by id - used by the thread screen to show what's being replied to */
export async function getPost(postId: string): Promise<Post | null> {
  const snap = await getDoc(doc(db, "posts", postId));
  return snap.exists() ? { id: snap.id, ...(snap.data() as Omit<Post, "id">) } : null;
}

/** replies to one post, oldest first - a single equality filter + orderBy, so no composite index is needed */
export async function getReplies(postId: string): Promise<Post[]> {
  const q = query(collection(db, "posts"), where("parentPostId", "==", postId), orderBy("createdAtMs", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }));
}

/** deletes a post outright - the author's own only, per firestore.rules. Any replies to it are left in place (their thread screen shows "This post was deleted" for the missing parent) rather than cascading, to keep this a single cheap write. */
export async function deletePost(postId: string): Promise<void> {
  await deleteDoc(doc(db, "posts", postId));
}

/** the public feed - every post, newest first, across every league */
export async function getFeedPosts(limitCount = 30): Promise<Post[]> {
  const q = query(collection(db, "posts"), orderBy("createdAtMs", "desc"), fsLimit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }));
}

/** comments attached to one specific matchup or trade, oldest first (reading top to bottom like a thread) */
export async function getPostsForTarget(
  targetType: "matchup" | "trade" | "waiver",
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

/** every post by one author, newest first - used for Boogie's profile (BOOGIE_UID), which only ever shows what he's actually posted himself. A single equality filter + orderBy, so no composite index is needed. */
export async function getPostsByAuthor(authorUid: string, limitCount = 50): Promise<Post[]> {
  const q = query(
    collection(db, "posts"),
    where("authorUid", "==", authorUid),
    orderBy("createdAtMs", "desc"),
    fsLimit(limitCount)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Post, "id">) }));
}

// Posts authored by "Boogie The Writer" - the same Fantasy Pulse staff
// writer persona already used for the Articles feature (see ShowAuthors.tsx
// and fetchPreview.js) - here playing beat reporter for the league's own
// breaking news: trades, waiver moves, and final scores, auto-announced
// into the feed/comment thread so those threads aren't empty until a real
// user happens to post about it. Uses a deterministic doc id (derived from
// the trade/matchup it's about) and checks existence before writing, so
// it's safe to call this every time any client views that trade/matchup -
// the first viewer creates it, every later call is a no-op read, and it
// can never be created twice even if two clients race on the same id,
// since the id (not the write) is what's unique.
export const BOOGIE_UID = "boogie";
/** Boogie's internal handle - his real Sleeper username, used as the routable "username" for his profile (/profile/123Cancun) and to look up his real leagues, even though he's not a real Firebase account. Not shown in the UI - his profile displays as "Boogie The Writer" only. */
export const BOOGIE_USERNAME = "123Cancun";
/** Boogie's real Sleeper user_id (123Cancun) - verified live against Sleeper's API before shipping. Used to pull his actual Fantasy Profile stats onto his profile page. */
export const BOOGIE_SLEEPER_USER_ID = "865355294702723072";
/** @deprecated kept as an alias - use BOOGIE_UID */
export const SYSTEM_AUTHOR_UID = BOOGIE_UID;

export interface EnsureSystemPostInput {
  id: string;
  text: string;
  imageUrl?: string;
  matchupCard?: MatchupCard;
  leagueId?: string;
  targetType: "matchup" | "trade" | "waiver";
  targetId: string;
  targetLabel?: string;
  createdAtMs?: number;
}

export async function ensureSystemPost(input: EnsureSystemPostInput): Promise<void> {
  const ref = doc(db, "posts", input.id);
  const existing = await getDoc(ref);
  if (existing.exists()) return;

  const now = input.createdAtMs ?? Date.now();
  await setDoc(ref, {
    authorUid: BOOGIE_UID,
    authorUsername: BOOGIE_USERNAME,
    authorDisplayName: "Boogie The Writer",
    authorAvatar: null,
    text: input.text,
    imageUrl: input.imageUrl ?? null,
    matchupCard: input.matchupCard ?? null,
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    leagueId: input.leagueId ?? null,
    targetType: input.targetType,
    targetId: input.targetId,
    targetLabel: input.targetLabel ?? null,
    likeCount: 0,
    replyCount: 0,
    repostCount: 0,
  });
}

/** every post one user has liked, most-recently-liked first - for a profile page's Likes tab, same as Twitter's */
export async function getPostsLikedByUser(uid: string, limitCount = 30): Promise<Post[]> {
  const q = query(
    collection(db, "postLikes"),
    where("uid", "==", uid),
    orderBy("createdAt", "desc"),
    fsLimit(limitCount)
  );
  const snap = await getDocs(q);
  const postIds = snap.docs.map((d) => (d.data().postId as string) ?? d.id.split("_")[0]);
  return resolvePostsInOrder(postIds);
}

/** every post one user has reposted, most-recently-reposted first - for a profile page's Reposts tab */
export async function getPostsRepostedByUser(uid: string, limitCount = 30): Promise<Post[]> {
  const q = query(
    collection(db, "postReposts"),
    where("uid", "==", uid),
    orderBy("createdAt", "desc"),
    fsLimit(limitCount)
  );
  const snap = await getDocs(q);
  const postIds = snap.docs.map((d) => (d.data().postId as string) ?? d.id.split("_")[0]);
  return resolvePostsInOrder(postIds);
}

/** fetches each id's post and drops any that no longer exist (deleted since being liked/reposted), preserving the caller's order */
async function resolvePostsInOrder(postIds: string[]): Promise<Post[]> {
  const posts = await Promise.all(postIds.map((id) => getPost(id)));
  return posts.filter((p): p is Post => p !== null);
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

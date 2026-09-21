import { doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs } from "firebase/firestore/lite";
import { db } from "./firebase";

// The social graph: which app users (by Firebase uid, from socialAuth.ts's
// profiles) follow which. One doc per relationship, keyed so it's directly
// addressable without a query for the common "does A follow B" check.

function followDocId(followerUid: string, followedUid: string): string {
  return `${followerUid}_${followedUid}`;
}

export async function followUser(followerUid: string, followedUid: string): Promise<void> {
  if (followerUid === followedUid) throw new Error("You can't follow yourself.");
  await setDoc(doc(db, "follows", followDocId(followerUid, followedUid)), {
    followerUid,
    followedUid,
    createdAt: new Date().toISOString(),
  });
}

export async function unfollowUser(followerUid: string, followedUid: string): Promise<void> {
  await deleteDoc(doc(db, "follows", followDocId(followerUid, followedUid)));
}

export async function isFollowing(followerUid: string, followedUid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "follows", followDocId(followerUid, followedUid)));
  return snap.exists();
}

export async function getFollowingUids(uid: string): Promise<string[]> {
  const q = query(collection(db, "follows"), where("followerUid", "==", uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data().followedUid as string);
}

export async function getFollowerUids(uid: string): Promise<string[]> {
  const q = query(collection(db, "follows"), where("followedUid", "==", uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data().followerUid as string);
}

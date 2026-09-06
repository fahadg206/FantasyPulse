// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
} from "firebase/firestore/lite";
import { getStorage } from "firebase/storage";
import { getAuth, signInAnonymously } from "firebase/auth";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBLCVmOdpdjWZOHgcvUDsS37udjRrvXNwg",
  authDomain: "fantasypulse-3523b.firebaseapp.com",
  projectId: "fantasypulse-3523b",
  storageBucket: "fantasypulse-3523b.appspot.com",
  messagingSenderId: "537780473762",
  appId: "1:537780473762:web:80cb568792997aa615ecfb",
  measurementId: "G-B885Y5X02R",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

let currentUser; // Declare currentUser variable

// Firestore security rules require an authenticated request, but this
// sign-in is fire-and-forget - any caller that reads/writes Firestore
// before it resolves gets rejected with "Missing or insufficient
// permissions." Exporting the promise lets server-side callers (API
// routes, which don't have the luxury of a long-lived browser session
// warming this up ahead of time) explicitly wait for it first.
const authReady = signInAnonymously(auth)
  .then((userCredential) => {
    currentUser = userCredential.user;
    //console.log("Anonymous user ID: ", currentUser.uid);
    // Perform actions after successful login
  })
  .catch((error) => {
    console.error("Anonymous sign-in error: ", error);
  });

export { auth, db, storage, authReady };

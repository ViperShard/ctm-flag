/**
 * firebase.js — all Firebase / Firestore logic lives here.
 *
 * This file is the ONLY place that talks to Firebase. content.js imports the
 * functions below and never touches the SDK directly.
 *
 * Uses the Firebase v9+ "modular" SDK (you import just the functions you need,
 * and webpack tree-shakes away the rest to keep the bundle small).
 *
 * Your actual project keys do NOT live here — they're in `firebase.config.js`
 * (git-ignored). This file is key-free and safe to commit. See DEVELOPER.md for
 * how to create the Firebase project and fill in your config.
 */
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
} from "firebase/firestore";

// Your keys come from the git-ignored config file (copy the .example first).
import { firebaseConfig } from "./firebase.config.js";

// Firestore collection that holds every tag. NOTE: the collection is still
// named "flags" (not "tags") on purpose — that way the product can be renamed
// to "CTM Tag" without forcing you to change the Firestore security rules,
// which reference `/flags/{callId}`. Users never see this name.
const COLLECTION = "flags";

// We keep these module-level so init() runs exactly once.
let db = null;
let initError = null;

/**
 * Initialise Firebase. Safe to call more than once. If the config is still the
 * placeholder, or anything throws, we record the error and return false so the
 * caller can degrade gracefully instead of crashing the CTM page.
 */
function init() {
  if (db) return true; // already good
  if (initError) return false; // already tried and failed; don't spam

  if (!firebaseConfig || firebaseConfig.apiKey === "YOUR_API_KEY") {
    initError = new Error(
      "Firebase config not filled in. Copy src/firebase.config.example.js to " +
        "src/firebase.config.js, add your keys, and rebuild."
    );
    console.warn("[CTM Tag] " + initError.message);
    return false;
  }

  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    return true;
  } catch (err) {
    initError = err;
    console.error("[CTM Tag] Firebase failed to initialise:", err);
    return false;
  }
}

/** True if Firebase is wired up and ready to read/write. */
export function isReady() {
  return init();
}

/**
 * A human-readable reason Firebase isn't ready (for showing a gentle message in
 * the UI). Returns null when everything's fine.
 */
export function getInitErrorMessage() {
  if (db) return null;
  if (initError) return initError.message;
  return "Firebase not initialised.";
}

/**
 * Listen to the ENTIRE tags collection in real time.
 *
 * `callback` is invoked immediately with the current set of tags, and again
 * every time anyone (you or a teammate) adds, edits, or removes a tag — usually
 * within a second. Each tag is a plain object:
 *   { callId, note, flaggedBy, timestamp }
 *
 * Returns an "unsubscribe" function, or a no-op if Firebase isn't ready.
 */
export function subscribeFlags(callback) {
  if (!init()) return () => {};

  try {
    const col = collection(db, COLLECTION);
    return onSnapshot(
      col,
      (snapshot) => {
        const tags = [];
        snapshot.forEach((d) => tags.push(d.data()));
        callback(tags);
      },
      (err) => {
        // Listener errors (e.g. security rules blocking reads) land here.
        console.error("[CTM Tag] Firestore listener error:", err);
      }
    );
  } catch (err) {
    console.error("[CTM Tag] Could not subscribe to tags:", err);
    return () => {};
  }
}

/**
 * Create or update a tag for a given call.
 * Resolves true on success, false on failure (never throws into the page).
 *
 * The document field is still `flaggedBy` (kept for backward compatibility with
 * the data model); it holds the display name of whoever tagged the call.
 */
export async function saveFlag(callId, note, taggedBy) {
  if (!init()) return false;
  try {
    await setDoc(doc(db, COLLECTION, String(callId)), {
      callId: String(callId),
      note: String(note || ""),
      flaggedBy: String(taggedBy || "Unknown"),
      timestamp: Date.now(), // plain number (ms since 1970)
    });
    return true;
  } catch (err) {
    console.error("[CTM Tag] Could not save tag:", err);
    return false;
  }
}

/**
 * Delete a tag by callId.
 * Resolves true on success, false on failure.
 */
export async function removeFlag(callId) {
  if (!init()) return false;
  try {
    await deleteDoc(doc(db, COLLECTION, String(callId)));
    return true;
  } catch (err) {
    console.error("[CTM Tag] Could not remove tag:", err);
    return false;
  }
}

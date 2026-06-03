/**
 * firebase.js — all Firebase / Firestore logic lives here.
 *
 * This file is the ONLY place that talks to Firebase. content.js imports the
 * functions below and never touches the SDK directly, so if you ever change
 * databases you only edit this one file.
 *
 * Uses the Firebase v9+ "modular" SDK (you import just the functions you need,
 * and webpack tree-shakes away the rest to keep the bundle small).
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  HOW TO FILL IN YOUR FIREBASE CONFIG  (one-time, ~5 minutes)
 * ───────────────────────────────────────────────────────────────────────────
 *  1. Go to https://console.firebase.google.com and click "Add project".
 *     (The free "Spark" plan is plenty for this — no credit card needed.)
 *  2. Once the project is created, in the left sidebar open
 *       Build → Firestore Database → "Create database".
 *     Choose "Start in test mode" for now (we tighten rules below), pick a
 *     location near you, and click Enable.
 *  3. Still in the console, click the gear icon (top-left) → "Project settings".
 *  4. Scroll down to "Your apps" and click the "</>" (web) icon to register a
 *     web app. Give it any nickname (e.g. "CTM Flag"). You do NOT need Hosting.
 *  5. Firebase shows you a `firebaseConfig = { ... }` snippet. Copy the
 *     apiKey, authDomain, and projectId values into the object below,
 *     replacing the placeholder strings.
 *
 *  (apiKey here is NOT a secret — for web Firebase apps it's a public project
 *   identifier. Access is controlled by the Firestore security rules, not by
 *   hiding this key. See the README for the recommended rules.)
 * ───────────────────────────────────────────────────────────────────────────
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

// ⬇⬇⬇  REPLACE THESE THREE PLACEHOLDER VALUES WITH YOUR OWN  ⬇⬇⬇
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
};
// ⬆⬆⬆  REPLACE THESE THREE PLACEHOLDER VALUES WITH YOUR OWN  ⬆⬆⬆

// Firestore collection that holds every flag. Each document's ID is the callId,
// so a call can only be flagged once (re-flagging overwrites the same doc).
const COLLECTION = "flags";

// We keep these module-level so init() runs exactly once.
let db = null;
let initError = null;

/**
 * Initialise Firebase. Safe to call more than once. If the config is still
 * the placeholder, or anything throws, we record the error and return false
 * so the caller can degrade gracefully instead of crashing the CTM page.
 */
function init() {
  if (db) return true; // already good
  if (initError) return false; // already tried and failed; don't spam

  if (firebaseConfig.apiKey === "YOUR_API_KEY") {
    initError = new Error(
      "Firebase config not filled in. Edit src/firebase.js and rebuild."
    );
    console.warn("[CTM Flag] " + initError.message);
    return false;
  }

  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    return true;
  } catch (err) {
    initError = err;
    console.error("[CTM Flag] Firebase failed to initialise:", err);
    return false;
  }
}

/**
 * True if Firebase is wired up and ready to read/write.
 */
export function isReady() {
  return init();
}

/**
 * A human-readable reason Firebase isn't ready (for showing a gentle message
 * in the UI). Returns null when everything's fine.
 */
export function getInitErrorMessage() {
  if (db) return null;
  if (initError) return initError.message;
  return "Firebase not initialised.";
}

/**
 * Listen to the ENTIRE flags collection in real time.
 *
 * `callback` is invoked immediately with the current set of flags, and again
 * every time anyone (you or a teammate) adds, edits, or removes a flag —
 * usually within a second. Each flag is a plain object:
 *   { callId, note, flaggedBy, timestamp }
 *
 * Returns an "unsubscribe" function. Call it to stop listening (we don't really
 * need to here since the page lives as long as the listener, but it's good form).
 * Returns a no-op function if Firebase isn't ready.
 */
export function subscribeFlags(callback) {
  if (!init()) return () => {};

  try {
    const col = collection(db, COLLECTION);
    return onSnapshot(
      col,
      (snapshot) => {
        const flags = [];
        snapshot.forEach((d) => flags.push(d.data()));
        callback(flags);
      },
      (err) => {
        // Listener errors (e.g. security rules blocking reads) land here.
        console.error("[CTM Flag] Firestore listener error:", err);
      }
    );
  } catch (err) {
    console.error("[CTM Flag] Could not subscribe to flags:", err);
    return () => {};
  }
}

/**
 * Create or update a flag for a given call.
 * Resolves true on success, false on failure (never throws into the page).
 */
export async function saveFlag(callId, note, flaggedBy) {
  if (!init()) return false;
  try {
    await setDoc(doc(db, COLLECTION, String(callId)), {
      callId: String(callId),
      note: String(note || ""),
      flaggedBy: String(flaggedBy || "Unknown"),
      timestamp: Date.now(), // plain number (ms since 1970), as per spec
    });
    return true;
  } catch (err) {
    console.error("[CTM Flag] Could not save flag:", err);
    return false;
  }
}

/**
 * Delete a flag by callId.
 * Resolves true on success, false on failure.
 */
export async function removeFlag(callId) {
  if (!init()) return false;
  try {
    await deleteDoc(doc(db, COLLECTION, String(callId)));
    return true;
  } catch (err) {
    console.error("[CTM Flag] Could not remove flag:", err);
    return false;
  }
}

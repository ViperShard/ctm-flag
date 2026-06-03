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
 * (git-ignored). This file is key-free and safe to commit. See DEVELOPER.md.
 *
 * TAG DOCUMENT SHAPE (collection "flags", one doc per call):
 *   {
 *     callId:     string,   // CTM's call id (also the document id)
 *     note:       string,
 *     flaggedBy:  string,   // display name of whoever tagged it
 *     timestamp:  number,   // ms since 1970
 *     clientId:   string,   // which CTM client/account the call belongs to
 *     clientName: string,   // human label for that client
 *     callUrl:    string,   // deep link back to the call in CTM
 *     status:     string,   // "open" | "resolved"
 *     readBy:     { [deviceId]: true }   // who has read it
 *   }
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

// Firestore collection that holds every tag. NOTE: still named "flags" (not
// "tags") on purpose, so the product rename to "CTM Tag" didn't force a change
// to the Firestore security rules, which reference `/flags/{callId}`. Users
// never see this name.
const COLLECTION = "flags";

let db = null;
let initError = null;

/**
 * Initialise Firebase. Safe to call repeatedly. Degrades gracefully (returns
 * false) instead of throwing into the CTM page.
 */
function init() {
  if (db) return true;
  if (initError) return false;

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

/** A human-readable reason Firebase isn't ready (null when fine). */
export function getInitErrorMessage() {
  if (db) return null;
  if (initError) return initError.message;
  return "Firebase not initialised.";
}

/**
 * Listen to the ENTIRE tags collection in real time. `callback` gets the full
 * array of tag objects immediately and again on every change. Returns an
 * unsubscribe function (or a no-op if Firebase isn't ready).
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
        console.error("[CTM Tag] Firestore listener error:", err);
      }
    );
  } catch (err) {
    console.error("[CTM Tag] Could not subscribe to tags:", err);
    return () => {};
  }
}

/**
 * Create a tag for a call.
 * `fields` = { note, taggedBy, clientId, clientName, callUrl }.
 * Uses merge so re-tagging never wipes an existing readBy map.
 * Resolves true/false; never throws.
 */
export async function saveFlag(callId, fields) {
  if (!init()) return false;
  const f = fields || {};
  try {
    await setDoc(
      doc(db, COLLECTION, String(callId)),
      {
        callId: String(callId),
        note: String(f.note || ""),
        flaggedBy: String(f.taggedBy || "Unknown"),
        timestamp: Date.now(),
        clientId: String(f.clientId || "unknown"),
        clientName: String(f.clientName || "Unknown client"),
        callUrl: String(f.callUrl || ""),
        status: "open",
      },
      { merge: true }
    );
    return true;
  } catch (err) {
    console.error("[CTM Tag] Could not save tag:", err);
    return false;
  }
}

/** Mark a tag read by a given device/identity. Merge so others' reads survive. */
export async function markRead(callId, identity) {
  if (!init() || !identity) return false;
  try {
    await setDoc(
      doc(db, COLLECTION, String(callId)),
      { readBy: { [identity]: true } },
      { merge: true }
    );
    return true;
  } catch (err) {
    console.error("[CTM Tag] Could not mark read:", err);
    return false;
  }
}

/** Set a tag's status ("open" | "resolved"). Soft-archive, never destroys. */
export async function setStatus(callId, status) {
  if (!init()) return false;
  try {
    await setDoc(
      doc(db, COLLECTION, String(callId)),
      { status: String(status) },
      { merge: true }
    );
    return true;
  } catch (err) {
    console.error("[CTM Tag] Could not change status:", err);
    return false;
  }
}

/**
 * Permanently delete a tag. Kept for the rare "remove for good" case; the normal
 * UI action is Resolve (setStatus) so nothing is lost by accident.
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

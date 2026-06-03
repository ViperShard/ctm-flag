# CTM Flag

A lightweight call-annotation tool for the **Call Tracking Metrics (CTM)** web
interface. It adds a small 📌 button to every call so anyone on your team (with
the extension installed) can flag a call with a note or question — and everyone
else sees that flag **in real time**, no refresh needed.

It injects directly into CTM's existing layout. No popups, no new tabs — the
buttons and the "Flagged Calls" panel appear inline and are styled to feel
native to CTM.

> Internal workplace tool. Flags are shared through a single Firebase Firestore
> database that you create (free tier). Anyone with the extension installed and
> pointed at that database sees the same flags.

---

## What it does

- **📌 on every call row** — click to add a note and flag the call. Already-
  flagged calls show a filled amber pin; click it to read the note or delete it.
- **"Flagged Calls" button** in the CTM toolbar with a live count badge.
- **Slide-down panel** listing every flagged call (newest first): the note, who
  flagged it, when, a **→ Go to call** link that scrolls to and highlights the
  row, and a **✕ Remove** button.
- **Real-time sync** — add or remove a flag and it appears/disappears for every
  teammate within about a second, via a Firestore `onSnapshot` listener.
- **Fails safe** — if Firebase isn't configured or is unreachable, the CTM page
  is never broken; the UI just tells you to finish setup (details in the
  browser console).

---

## Works in Chrome, Edge, and other Chromium browsers

This is a standard Manifest V3 extension. It loads in Chrome, **Edge**, Brave,
Opera, Vivaldi, and Arc with no changes. (A `browser_specific_settings.gecko`
block is included for Firefox; Safari needs Apple's converter — see bottom.)

The "who flagged this" name is stored with the browser's standard `localStorage`
(not `chrome.storage`), so it behaves identically in Edge and Chrome. Only your
display name is stored locally — the flags themselves all live in Firebase.

---

## Setup

You'll do this once. Steps 1–3 create a free database; steps 4–6 build and load
the extension.

### 1. Install build tools

```bash
npm install
```

### 2. Create a free Firebase project + Firestore database

1. Go to <https://console.firebase.google.com> → **Add project** (the free
   "Spark" plan is fine; no credit card). Finish the wizard, then **click the
   project tile to open it** — the sidebar only appears once you're inside.
2. In the **left sidebar**, **Build** is a category heading (not a button) —
   click it to expand, then click **Firestore Database**. (No sidebar? Click
   the **☰** icon top-left. Fastest shortcut: type `Firestore` in the search
   bar at the top of the console.)
3. On the Firestore Database page, click the blue **Create database** button →
   choose **Start in test mode** → pick a location → **Enable**.
4. Click the **gear icon → Project settings**.
5. Under **Your apps**, click the **`</>`** (web) icon to register a web app.
   Give it any nickname. You do **not** need Firebase Hosting.
6. Firebase shows a `firebaseConfig = { ... }` snippet. Keep that tab open.

### 3. Set the Firestore security rules

In the console: **Firestore Database → Rules**, paste this, and **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /flags/{callId} {
      allow read, write: if true;   // internal tool, no auth (MVP)
    }
  }
}
```

> ⚠️ `if true` means anyone who knows your project ID can read/write the `flags`
> collection. That's intentional for an internal MVP with no login. If you want
> it locked down later, add Firebase Auth and change the rule to
> `if request.auth != null`.

### 4. Paste your config into the extension

Open [`src/firebase.js`](src/firebase.js) and replace the three placeholder
values near the top with the ones from your `firebaseConfig` snippet:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
};
```

(The `apiKey` is **not** a secret for web Firebase apps — it's a public project
identifier. Access is controlled by the rules above, not by hiding the key.)

### 5. Build

```bash
npm run build
```

This bundles Firebase into a single file and writes the finished extension to
the **`dist/`** folder.

### 6. Load it in your browser

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the **`dist/`** folder.
4. Open CTM. The 📌 buttons and the "Flagged Calls" toolbar button appear.

The first time you flag a call it asks for your name (stored locally so you
won't be asked again; change it anytime via the panel header).

---

## Adjusting the selectors (if buttons don't appear)

CTM's exact HTML isn't known ahead of time, so the script uses best-guess CSS
selectors and **logs what it found** to the browser console.

1. On a CTM call-log page, open DevTools (**F12**) → **Console**.
2. Look for `[CTM Flag]` lines. They tell you how many call rows and call IDs
   were detected. If it says **0 call IDs detected**, the selectors need tuning.
3. Right-click a real call row → **Inspect** to see CTM's actual markup.
4. Edit the `CTM_SELECTORS` object at the top of
   [`src/content.js`](src/content.js):

   ```js
   const CTM_SELECTORS = {
     callRow: ".call-row, [data-call-id], tr.call, tr[data-id], .activity-row",
     callId:  "[data-call-id], .call-id, .call-number, [data-id]",
     toolbar: ".toolbar, .header-actions, .page-header, header, nav",
   };
   ```

   Add the class/attribute you see in CTM's HTML to the matching line.
5. `npm run build` again, then in `chrome://extensions` click the **↻** on the
   CTM Flag card and refresh the CTM tab.

---

## Project layout

```
ctm-flag/
├── src/
│   ├── content.js     injected into CTM — all the UI + behaviour
│   ├── firebase.js    Firebase init + read/write/delete/listen
│   └── style.css      injected styles (matches CTM's clean look)
├── icons/             extension + site icons (neutral amber pin)
├── docs/              GitHub Pages landing page
├── manifest.json      MV3 config
├── package.json       build scripts + deps
├── webpack.config.js  bundles Firebase, copies static files into dist/
└── dist/              ← built output; this is what you "Load unpacked"
```

> **Note on `manifest.json` permissions / `web_accessible_resources`:** none are
> needed. The script and styles are injected via `content_scripts`, the display
> name uses `localStorage` (not the `storage` permission), and Firestore's HTTPS
> endpoints serve permissive CORS, so no host permissions are required either.
> Fewer permissions = a smaller install warning and a simpler trust story.

---

## Development

```bash
npm run dev     # rebuild automatically on every save (then click ↻ + refresh)
npm run build   # one-off production build
```

After any change, bump `version` in `manifest.json` so teammates can tell
they're on the latest build.

---

## Other browsers

- **Firefox** — `about:debugging#/runtime/this-firefox` → **Load Temporary
  Add-on** → pick `dist/manifest.json`. (Temporary add-ons unload on restart;
  a permanent install needs AMO signing.)
- **Safari** — the source is standard MV3 and converts with Apple's
  `safari-web-extension-converter` (an Xcode tool) without code changes.

---

## License

MIT — see [LICENSE](LICENSE).

# CTM Tag — developer / setup guide

This is for the **one person** who sets CTM Tag up for the team (creates the
shared database and produces the installable zip). Teammates don't need any of
this — they just follow [README.md](README.md).

CTM Tag is a Manifest V3 browser extension. A content script injects a tagging
UI into Call Tracking Metrics (`*.calltrackingmetrics.com`), and tags are shared
through **Firebase Firestore** in real time (`onSnapshot`). It's plain
vanilla JS, bundled with webpack so Firebase is compiled into one file.

---

## One-time setup

### 1. Install build tools

```bash
npm install
```

### 2. Create a free Firebase project + Firestore database

1. Go to <https://console.firebase.google.com> → **Add project** (the free
   "Spark" plan is fine; no credit card). Finish the wizard, then **click the
   project tile to open it** — the sidebar only appears once you're inside.
2. In the **left sidebar**, **Build** is a category heading (not a button) —
   click it to expand, then click **Firestore Database**. (No sidebar? Click the
   **☰** icon top-left. Fastest shortcut: type `Firestore` in the search bar at
   the top of the console.)
3. On the Firestore Database page, click **Create database** → **Start in test
   mode** → pick a location → **Enable**.

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

> The collection is named **`flags`** (not `tags`) on purpose — that's the
> original data-model name, kept so the product rename to "CTM Tag" didn't force
> a rules change. Users never see it.
>
> ⚠️ **Test mode expires in ~30 days.** The rule above (`if true`) has no expiry,
> so publishing it is what keeps tagging working long-term. Trade-off: `if true`
> lets anyone who knows the project ID read/write the `flags` collection — fine
> for an internal MVP with no login. To lock it down later, add Firebase Auth and
> change the rule to `if request.auth != null`.

### 4. Add your config keys

Your keys live in a **git-ignored** file so they never reach the public repo:

```bash
cp src/firebase.config.example.js src/firebase.config.js
```

Then open `src/firebase.config.js` and paste in your real values from the
Firebase console (**⚙️ Project settings → Your apps → register a `</>` web app →
the `firebaseConfig` snippet**). You only need three fields:

```js
export const firebaseConfig = {
  apiKey: "AIza…",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
};
```

(`apiKey` is a public client identifier for web Firebase apps, not a secret —
access is controlled by the security rules above.)

### 5. Build the shareable zip

```bash
npm run package
```

This builds the extension and zips it into **`ctm-tag-extension.zip`**, with your
config baked in. **`firebase.config.js` and the zip are both git-ignored**, so
your keys never get committed.

---

## Sharing with the team (they do no setup)

1. Send everyone **`ctm-tag-extension.zip`** privately (Slack / email / shared
   drive). **Do not upload it to the public repo** — it contains your config.
2. Point them at [README.md](README.md) (or just tell them: unzip →
   `edge://extensions` → Developer mode → **Load unpacked** → pick the folder).

Pushed a code update? Re-run `npm run package` and send the new zip; teammates
replace the folder and click **↻** on the extension card. (For true one-click
installs + auto-updates, the same build can later be published unlisted to the
Edge Add-ons store.)

## Test it yourself without zipping

You can load the built folder directly:

```bash
npm run build
```

Then `edge://extensions` → Developer mode → **Load unpacked** → select the
**`dist/`** folder (the one containing `content.js`, *not* the project root).

For live development:

```bash
npm run dev      # rebuilds on every save; then click ↻ on the extension card
```

Bump `version` in `manifest.json` on each user-visible change.

---

## Adjusting the selectors (if pins don't appear)

CTM's exact HTML isn't known ahead of time, so the script uses best-guess CSS
selectors and **logs what it found** to the browser console.

1. On a CTM call-log page, open DevTools (**F12**) → **Console**.
2. Look for `[CTM Tag]` lines — they report how many call rows and call IDs were
   detected. **0 call IDs** means the selectors need tuning.
3. Right-click a real call row → **Inspect** to see CTM's actual markup.
4. Edit the `CTM_SELECTORS` object at the top of
   [`src/content.js`](src/content.js) to match, then `npm run package` again.

The "Tagged Calls" button injects into the first element matching the `toolbar`
selector; if none matches, it falls back to a small floating button in the
top-right corner — so it's always reachable.

---

## Project layout

```
ctm-tag/   (repo slug is still "ctm-flag")
├── src/
│   ├── content.js                injected UI: pins, editor, panel, real-time, highlight
│   ├── firebase.js               Firebase init + read/write/listen (key-free, committed)
│   ├── firebase.config.example.js  TEMPLATE for your keys (committed)
│   ├── firebase.config.js        YOUR keys (git-ignored — you create this)
│   └── style.css                 injected styles (matches CTM's look)
├── icons/                        amber-pin icons (16/48/128 + favicon)
├── screenshots/                  README images
├── docs/index.html               GitHub Pages landing page
├── manifest.json                 MV3 config
├── webpack.config.js             bundles Firebase, copies static files into dist/
├── package.json                  build / dev / package scripts
└── dist/                         build output (git-ignored)
```

## Implementation notes

- **No background worker, minimal permissions.** Script + styles are injected via
  `content_scripts`; Firestore's HTTPS endpoints serve permissive CORS, so no
  host permissions are needed; the display name uses `localStorage` (a plain web
  API that works the same in Edge/Chrome/Firefox/Safari — **not**
  `chrome.storage`, which is extension-API-specific). Fewer permissions = a
  smaller install warning.
- **Internal naming.** The Firestore collection (`flags`), the document field
  (`flaggedBy`), and the CSS/JS identifiers (`ctmflag-…`) keep their original
  names for stability; only user-visible text says "tag." None of this is visible
  to users.
- **Fails safe.** Every Firebase call is guarded — if Firebase is unreachable or
  unconfigured, the CTM page is never broken; the UI just shows a "finish setup"
  hint.

---

## Other browsers

- **Firefox** — `about:debugging#/runtime/this-firefox` → **Load Temporary
  Add-on** → pick `dist/manifest.json`. (Temporary add-ons unload on restart; a
  permanent install needs AMO signing.)
- **Safari** — the source is standard MV3 and converts with Apple's
  `safari-web-extension-converter` (an Xcode tool) without code changes.

## License

MIT — see [LICENSE](LICENSE).

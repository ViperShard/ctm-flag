# Installing CTM Flag — for teammates

**No accounts. No coding. About 2 minutes.** You don't need to set up anything
with Firebase or build anything — that's already done. You just turn the
extension on.

You should have received a file called **`ctm-flag-extension.zip`** (from Slack,
email, or a shared drive). Have that handy.

> Works in **Microsoft Edge** and **Google Chrome** (the steps are nearly
> identical — differences are noted).

---

## Steps

### 1. Unzip the file
Double-click **`ctm-flag-extension.zip`**. You'll get a folder named
**`ctm-flag-extension`**.

📌 **Put that folder somewhere permanent** (e.g. your Documents folder) and
**don't delete or move it later** — the extension runs directly from this folder.

### 2. Open your browser's Extensions page
- **Edge:** click the **`···`** menu (top-right) → **Extensions** → **Manage
  extensions**. *(Or type `edge://extensions` in the address bar and press
  Enter.)*
- **Chrome:** type `chrome://extensions` in the address bar and press Enter.

### 3. Turn on "Developer mode"
Flip the **Developer mode** switch.
- **Edge:** it's in the **bottom-left** corner.
- **Chrome:** it's in the **top-right** corner.

### 4. Click "Load unpacked"
A **Load unpacked** button appears. Click it, then select the
**`ctm-flag-extension`** folder you unzipped in step 1.
*(Pick the folder that has a file called `manifest.json` inside it.)*

### 5. Done! ✅
Open **Call Tracking Metrics**. You'll see:
- a small **📌 pin** on each call row, and
- a **"Flagged Calls"** button at the top.

The first time you flag a call, it asks for **your name** (so teammates know who
flagged it). Type it once — you won't be asked again.

---

## Good to know

- **That "developer extensions" notice in Edge/Chrome is normal** for tools
  installed this way. You can keep it; it doesn't mean anything is wrong.
- **Everyone shares the same flags in real time.** When you flag a call,
  teammates see it within about a second, and you see theirs — no refresh.
- **If you get an updated zip later:** unzip it over the old folder (replace the
  contents), then go back to the Extensions page and click the **↻ reload**
  icon on the CTM Flag card.

---

## If the pins don't appear

1. Make sure you're on a Call Tracking Metrics page with a list of calls.
2. Press **F12** to open Developer Tools → click the **Console** tab.
3. Look for lines starting with **`[CTM Flag]`** and send a screenshot to
   whoever shared the extension with you — those messages say exactly what it
   found and make it a quick fix.

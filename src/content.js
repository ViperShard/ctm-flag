/**
 * content.js — the entire CTM Tag UI and behaviour.
 *
 * This script is injected by the browser into every Call Tracking Metrics page
 * (see manifest.json "matches"). It:
 *   1. Finds the call rows in CTM's table and drops a small 📌 button on each.
 *   2. Adds a "Tagged Calls" button to CTM's toolbar.
 *   3. Builds a slide-down panel listing every flagged call.
 *   4. Keeps all of the above in sync with Firebase Firestore in real time, so
 *      a flag added by one teammate appears for everyone within ~1 second.
 *
 * It is written to NEVER break the CTM page: every Firebase call is guarded,
 * and DOM work is defensive. If Firebase isn't configured, the UI still loads
 * and simply tells you to finish setup.
 *
 * The Firebase plumbing lives in firebase.js — this file just calls into it.
 */
import {
  subscribeFlags,
  saveFlag,
  removeFlag,
  markRead,
  setStatus,
  isReady,
  getInitErrorMessage,
} from "./firebase.js";

(() => {
  "use strict";

  // Guard against being injected twice (some single-page apps re-run scripts).
  if (window.__ctmFlagLoaded) return;
  window.__ctmFlagLoaded = true;

  /* ─────────────────────────────────────────────────────────────────────────
   *  CTM_SELECTORS — THE ONE THING YOU MIGHT NEED TO EDIT.
   *
   *  CTM's real HTML is not known in advance, and it may change over time, so
   *  these are best-guess CSS selectors. On load, this script prints to the
   *  browser console (F12 → Console) how many call rows and call IDs it found.
   *  If it finds 0, open CTM, inspect a call row (right-click → Inspect), and
   *  update the selectors below to match the real markup, then rebuild.
   *
   *  See README → "Adjusting the selectors" for a step-by-step.
   * ──────────────────────────────────────────────────────────────────────── */
  const CTM_SELECTORS = {
    // A row representing a single call in the call log table.
    callRow: ".call-row, [data-call-id], tr.call, tr[data-id], .activity-row",
    // An element (inside a row) that carries the call's unique ID.
    callId: "[data-call-id], .call-id, .call-number, [data-id]",
    // The header / toolbar area where the "Tagged Calls" button is added.
    toolbar: ".toolbar, .header-actions, .page-header, header, nav",
  };

  /* ─────────────────────────────────────────────────────────────────────────
   *  CTM_CLIENT — how to figure out which CTM "client"/account a call belongs
   *  to. This powers the Inbox grouping and (later) the per-client access wall.
   *  Like the selectors above, these are best guesses that get logged to the
   *  console so they're easy to tune once we see CTM's real URLs/markup.
   *
   *    urlPatterns  — regexes tried against the page URL; first capture group
   *                   becomes the clientId.
   *    nameSelectors — DOM elements whose text is the human client/account name
   *                   (e.g. an account switcher).
   * ──────────────────────────────────────────────────────────────────────── */
  const CTM_CLIENT = {
    urlPatterns: [
      /[?&]account_id=(\d+)/i,
      /\/accounts?\/(\d+)/i,
      /\/clients?\/(\d+)/i,
      /\/a\/(\d+)/i,
    ],
    nameSelectors: [
      "[data-account-name]",
      ".account-switcher .selected",
      ".current-account",
      ".account-name",
      ".navbar-brand",
    ],
  };

  // Marker attributes so we recognise our own injected elements and never
  // double-inject or react to them in the MutationObserver.
  const ATTR_BTN = "data-ctmflag-btn"; // on each row's flag button
  const ATTR_ROW_ID = "data-ctmflag-id"; // on the row, stores its callId

  // localStorage key for "who am I" (the flaggedBy name). We deliberately use
  // localStorage — a plain web API that works the same in Edge, Chrome, Firefox
  // and Safari — instead of chrome.storage, which is extension-API-specific.
  // Only the *name* is stored locally; the flags themselves live in Firebase.
  const NAME_KEY = "ctmflag_user";

  /* ── State ──────────────────────────────────────────────────────────────── */
  let flagsByCallId = new Map(); // callId -> tag object
  let panelOpen = false;
  let openEditorEl = null; // the currently-open inline note editor, if any
  let loggedScanOnce = false;
  let inboxFilter = "open"; // "open" | "resolved" | "all"
  let loggedClientOnce = false;

  /* ── Identity (flaggedBy) ───────────────────────────────────────────────── */

  function readName() {
    try {
      return (localStorage.getItem(NAME_KEY) || "").trim();
    } catch (e) {
      return "";
    }
  }
  function writeName(name) {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch (e) {
      /* private mode etc. — ignore */
    }
  }
  // Returns the saved name, prompting once if we don't have one yet.
  function getUserName(promptIfMissing) {
    let name = readName();
    if (!name && promptIfMissing) {
      name = (
        window.prompt(
          "CTM Tag — enter your name so teammates know who tagged a call:"
        ) || ""
      ).trim();
      if (name) writeName(name);
    }
    return name;
  }
  // Let the user change their display name from the panel.
  function changeUserName() {
    const next = (
      window.prompt("Your display name on tags:", readName()) || ""
    ).trim();
    if (next) {
      writeName(next);
      updateIdentityLabel();
    }
  }

  // A stable per-browser id used to track who has READ a tag (read/unread).
  // Random + local; when real sign-in lands (Increment B) this becomes the uid.
  function getDeviceId() {
    let id = "";
    try {
      id = localStorage.getItem("ctmflag_device") || "";
    } catch (e) {}
    if (!id) {
      id =
        "d_" +
        Math.random().toString(36).slice(2) +
        Math.random().toString(36).slice(2);
      try {
        localStorage.setItem("ctmflag_device", id);
      } catch (e) {}
    }
    return id;
  }

  /* ── Which CTM client/account are we looking at? ─────────────────────────── */

  function detectClient() {
    const url = location.href;
    let clientId = "";
    for (const re of CTM_CLIENT.urlPatterns) {
      const m = url.match(re);
      if (m && m[1]) {
        clientId = m[1];
        break;
      }
    }

    let clientName = "";
    for (const sel of CTM_CLIENT.nameSelectors) {
      let node = null;
      try {
        node = document.querySelector(sel);
      } catch (e) {}
      if (node) {
        clientName =
          (node.getAttribute("data-account-name") || node.textContent || "")
            .trim()
            .slice(0, 80);
        if (clientName) break;
      }
    }

    // Fallbacks so grouping still works even when detection misses.
    if (!clientId) clientId = clientName || location.hostname;
    if (!clientName) clientName = clientId || "Unknown client";

    if (!loggedClientOnce) {
      loggedClientOnce = true;
      console.log(
        "[CTM Tag] Detected client:",
        { clientId, clientName },
        "— if this looks wrong, tune CTM_CLIENT at the top of content.js."
      );
    }
    return { clientId, clientName };
  }

  // Best deep link back to a specific call: prefer a permalink in the row, else
  // the current page URL.
  function getCallUrl(row) {
    if (row) {
      const link = row.querySelector('a[href*="call"], a[href*="activity"]');
      if (link && link.href) return link.href;
    }
    return location.href;
  }

  /* ── Small helpers ──────────────────────────────────────────────────────── */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch (e) {
      return "";
    }
  }

  function pinSVG() {
    // A simple location-pin. CSS controls outline (unflagged) vs filled (flagged).
    return (
      '<svg class="ctmflag-pin" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
      '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/>' +
      "</svg>"
    );
  }

  function toast(message) {
    const t = el("div", "ctmflag-toast", message);
    document.body.appendChild(t);
    // force reflow so the transition runs
    void t.offsetWidth;
    t.classList.add("is-visible");
    setTimeout(() => {
      t.classList.remove("is-visible");
      setTimeout(() => t.remove(), 300);
    }, 3500);
  }

  /* ── Call row + call ID detection ───────────────────────────────────────── */

  function findCallRows() {
    let rows = [];
    try {
      rows = Array.from(document.querySelectorAll(CTM_SELECTORS.callRow));
    } catch (e) {
      console.error("[CTM Tag] Bad callRow selector:", e);
    }
    return rows;
  }

  // Try several strategies to pull a stable unique ID out of a row.
  function getCallId(row) {
    // 1) Data attributes directly on the row.
    const direct =
      row.getAttribute("data-call-id") ||
      row.getAttribute("data-callid") ||
      row.getAttribute("data-call") ||
      row.getAttribute("data-id");
    if (direct) return direct.trim();

    // 2) A child element that carries the ID.
    let idEl = null;
    try {
      idEl = row.querySelector(CTM_SELECTORS.callId);
    } catch (e) {
      /* ignore bad selector */
    }
    if (idEl) {
      const a =
        idEl.getAttribute("data-call-id") || idEl.getAttribute("data-id");
      if (a) return a.trim();
      const t = (idEl.textContent || "").trim();
      if (t) return t;
    }

    // 3) A link that looks like a call permalink, e.g. /calls/123456 or ?call=123456
    const link = row.querySelector('a[href*="call"], a[href*="activity"]');
    if (link) {
      const href = link.getAttribute("href") || "";
      const m = href.match(/(?:calls?|activity)[\/=_-]?(\d{3,})/i);
      if (m) return m[1];
    }

    return null; // couldn't find one — row won't get a flag button
  }

  /* ── Inject the per-row flag buttons ────────────────────────────────────── */

  function injectRowButtons() {
    const rows = findCallRows();
    let withId = 0;
    const sample = [];

    rows.forEach((row) => {
      // Already processed? Just refresh its state and move on.
      const existing = row.querySelector("[" + ATTR_BTN + "]");
      const callId = row.getAttribute(ATTR_ROW_ID) || getCallId(row);
      if (!callId) return;
      withId++;
      if (sample.length < 5) sample.push(callId);

      if (existing) {
        setButtonState(existing, callId);
        return;
      }

      row.setAttribute(ATTR_ROW_ID, callId);
      const btn = createRowButton(callId);
      placeRowButton(row, btn);
      setButtonState(btn, callId);
    });

    // One-time console diagnostics so a developer can verify the selectors.
    if (!loggedScanOnce) {
      loggedScanOnce = true;
      console.log(
        "%c[CTM Tag] active",
        "color:#3b6ea5;font-weight:bold;font-size:12px"
      );
      console.log("[CTM Tag] Selectors in use:", CTM_SELECTORS);
      console.log(
        "[CTM Tag] Found " +
          rows.length +
          " candidate call rows; " +
          withId +
          " had a detectable call ID."
      );
      if (withId === 0) {
        console.warn(
          "[CTM Tag] No call IDs detected. Edit CTM_SELECTORS at the top of " +
            "content.js to match CTM's real markup, then rebuild. " +
            "See README → 'Adjusting the selectors'."
        );
      } else {
        console.log("[CTM Tag] Sample call IDs:", sample);
      }
    }
  }

  function createRowButton(callId) {
    const btn = el("button", "ctmflag-row-btn");
    btn.type = "button";
    btn.setAttribute(ATTR_BTN, "1");
    btn.setAttribute(ATTR_ROW_ID, callId);
    btn.innerHTML = pinSVG();
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation(); // CTM may have a row-level click handler; don't trigger it
      toggleEditor(callId, btn);
    });
    return btn;
  }

  // Place the button without disturbing CTM's table layout: drop it inside the
  // last cell rather than adding a new column.
  function placeRowButton(row, btn) {
    const wrap = el("span", "ctmflag-row-btn-wrap");
    wrap.appendChild(btn);
    const cells = row.querySelectorAll("td");
    if (cells.length) {
      cells[cells.length - 1].appendChild(wrap);
    } else {
      row.appendChild(wrap);
    }
  }

  function setButtonState(btn, callId) {
    const flagged = flagsByCallId.has(callId);
    btn.classList.toggle("is-flagged", flagged);
    btn.title = flagged ? "Tagged — click to view" : "Tag this call";
  }

  function updateAllButtonStates() {
    document.querySelectorAll("[" + ATTR_BTN + "]").forEach((btn) => {
      const callId = btn.getAttribute(ATTR_ROW_ID);
      setButtonState(btn, callId);
    });
  }

  /* ── Inline note editor (the little popover by a row's pin) ──────────────── */

  function closeEditor() {
    if (openEditorEl) {
      openEditorEl.remove();
      openEditorEl = null;
      document.removeEventListener("mousedown", onDocMouseDown, true);
      window.removeEventListener("scroll", closeEditor, true);
    }
  }

  function onDocMouseDown(e) {
    if (openEditorEl && !openEditorEl.contains(e.target)) closeEditor();
  }

  function toggleEditor(callId, anchorBtn) {
    // Clicking the same row's pin again closes the editor.
    if (openEditorEl && openEditorEl.getAttribute("data-for") === callId) {
      closeEditor();
      return;
    }
    closeEditor();

    const flag = flagsByCallId.get(callId);
    const pop = el("div", "ctmflag-editor");
    pop.setAttribute("data-for", callId);

    if (flag) {
      buildViewEditor(pop, flag);
    } else {
      buildNewEditor(pop, callId);
    }

    document.body.appendChild(pop);
    positionPopover(pop, anchorBtn);
    openEditorEl = pop;

    // Close when clicking elsewhere or scrolling the page.
    document.addEventListener("mousedown", onDocMouseDown, true);
    window.addEventListener("scroll", closeEditor, true);

    const ta = pop.querySelector("textarea");
    if (ta) ta.focus();
  }

  // Editor shown for an UNTAGGED call: textarea + Tag it / Cancel.
  function buildNewEditor(pop, callId) {
    const ta = el("textarea", "ctmflag-textarea");
    ta.placeholder = "Note or question about this call...";
    ta.rows = 3;

    const actions = el("div", "ctmflag-editor-actions");
    const flagBtn = el("button", "ctmflag-btn-primary", "Tag it");
    flagBtn.type = "button";
    const cancel = el("button", "ctmflag-btn-ghost", "Cancel");
    cancel.type = "button";

    flagBtn.addEventListener("click", async () => {
      const name = getUserName(true);
      if (!name) {
        toast("Add your name first so tags can be attributed.");
        return;
      }
      flagBtn.disabled = true;
      const row = findRowByCallId(callId);
      const client = detectClient();
      const ok = await saveFlag(callId, {
        note: ta.value.trim(),
        taggedBy: name,
        clientId: client.clientId,
        clientName: client.clientName,
        callUrl: getCallUrl(row),
      });
      if (!ok) {
        flagBtn.disabled = false;
        toast("Couldn't save the tag — check Firebase setup (see console).");
        return;
      }
      closeEditor();
    });
    cancel.addEventListener("click", closeEditor);
    // Ctrl/Cmd+Enter to save quickly.
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") flagBtn.click();
    });

    actions.appendChild(cancel);
    actions.appendChild(flagBtn);
    pop.appendChild(ta);
    pop.appendChild(actions);
  }

  // Editor shown for an ALREADY-TAGGED call: note + who/when + Resolve/Delete.
  function buildViewEditor(pop, flag) {
    // Opening the note counts as reading it.
    markRead(flag.callId, getDeviceId());

    const meta = el("div", "ctmflag-editor-meta");
    meta.appendChild(el("span", "ctmflag-editor-by", flag.flaggedBy || "Unknown"));
    meta.appendChild(el("span", "ctmflag-editor-when", formatTime(flag.timestamp)));

    const note = el("div", "ctmflag-editor-note", flag.note || "(no note added)");

    const actions = el("div", "ctmflag-editor-actions");

    const resolved = flag.status === "resolved";
    const resolveBtn = el(
      "button",
      "ctmflag-btn-primary",
      resolved ? "Reopen" : "Resolve"
    );
    resolveBtn.type = "button";
    resolveBtn.addEventListener("click", async () => {
      resolveBtn.disabled = true;
      const ok = await setStatus(flag.callId, resolved ? "open" : "resolved");
      if (!ok) {
        resolveBtn.disabled = false;
        toast("Couldn't update — check console.");
        return;
      }
      closeEditor();
    });

    const del = el("button", "ctmflag-btn-danger", "Delete");
    del.type = "button";
    del.addEventListener("click", async () => {
      if (
        !window.confirm(
          "Delete this tag for everyone? This can't be undone.\n" +
            "(Use Resolve to archive it instead — nothing is lost.)"
        )
      )
        return;
      del.disabled = true;
      const ok = await removeFlag(flag.callId);
      if (!ok) {
        del.disabled = false;
        toast("Couldn't delete the tag — check console.");
        return;
      }
      closeEditor();
    });

    const close = el("button", "ctmflag-btn-ghost", "Close");
    close.type = "button";
    close.addEventListener("click", closeEditor);

    actions.appendChild(del);
    actions.appendChild(resolveBtn);
    actions.appendChild(close);
    pop.appendChild(meta);
    pop.appendChild(note);
    pop.appendChild(actions);
  }

  // Position the popover just below its anchor button, kept within the viewport.
  function positionPopover(pop, anchorBtn) {
    const r = anchorBtn.getBoundingClientRect();
    const width = 260;
    let left = r.left;
    if (left + width > window.innerWidth - 12) {
      left = window.innerWidth - width - 12;
    }
    left = Math.max(12, left);
    pop.style.position = "fixed";
    pop.style.top = Math.round(r.bottom + 6) + "px";
    pop.style.left = Math.round(left) + "px";
    pop.style.width = width + "px";
  }

  /* ── Toolbar "Tagged Calls" button ─────────────────────────────────────── */

  function injectToolbarButton() {
    if (document.getElementById("ctmflag-toolbar-btn")) return;

    const btn = el("button", "ctmflag-toolbar-btn ctmflag-floating");
    btn.id = "ctmflag-toolbar-btn";
    btn.type = "button";
    btn.innerHTML =
      '<span class="ctmflag-tb-pin">📌</span>' +
      '<span class="ctmflag-tb-label">Tagged Calls</span>' +
      '<span class="ctmflag-tb-badge" hidden>0</span>';
    btn.addEventListener("click", togglePanel);

    // Always a fixed, floating launcher so it's guaranteed visible regardless of
    // CTM's markup. Nesting it inside CTM's toolbar proved unreliable: CTM is a
    // single-page app that re-renders its header, so a nested button could be
    // thrown away or land off-screen. A fixed element on <body> can't be lost.
    (document.body || document.documentElement).appendChild(btn);
  }

  // Has THIS browser read the tag yet?
  function isUnread(flag) {
    const id = getDeviceId();
    return !(flag.readBy && flag.readBy[id]);
  }

  function updateBadge() {
    const badge = document.querySelector("#ctmflag-toolbar-btn .ctmflag-tb-badge");
    if (!badge) return;
    let count = 0;
    flagsByCallId.forEach((f) => {
      if ((f.status || "open") !== "resolved" && isUnread(f)) count++;
    });
    if (count > 0) {
      badge.textContent = String(count);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  /* ── The slide-down Tagged Calls panel ─────────────────────────────────── */

  function buildPanel() {
    if (document.getElementById("ctmflag-panel")) return;

    const panel = el("div", "ctmflag-panel");
    panel.id = "ctmflag-panel";

    const header = el("div", "ctmflag-panel-header");
    const title = el("div", "ctmflag-panel-title");
    title.innerHTML = '<span class="ctmflag-tb-pin">📌</span> Inbox';

    const right = el("div", "ctmflag-panel-head-right");
    const identity = el("button", "ctmflag-identity");
    identity.type = "button";
    identity.title = "Click to change the name shown on your tags";
    identity.addEventListener("click", changeUserName);
    const close = el("button", "ctmflag-panel-close", "✕");
    close.type = "button";
    close.title = "Close";
    close.addEventListener("click", closePanel);

    right.appendChild(identity);
    right.appendChild(close);
    header.appendChild(title);
    header.appendChild(right);

    // Filter bar: Open / Resolved / All.
    const filters = el("div", "ctmflag-filters");
    [
      ["open", "Open"],
      ["resolved", "Resolved"],
      ["all", "All"],
    ].forEach(([key, label]) => {
      const b = el("button", "ctmflag-filter", label);
      b.type = "button";
      b.setAttribute("data-filter", key);
      if (key === inboxFilter) b.classList.add("is-active");
      b.addEventListener("click", () => {
        inboxFilter = key;
        filters
          .querySelectorAll(".ctmflag-filter")
          .forEach((x) =>
            x.classList.toggle(
              "is-active",
              x.getAttribute("data-filter") === key
            )
          );
        renderPanel();
      });
      filters.appendChild(b);
    });

    const list = el("div", "ctmflag-panel-list");

    panel.appendChild(header);
    panel.appendChild(filters);
    panel.appendChild(list);
    document.body.appendChild(panel);

    updateIdentityLabel();
  }

  function updateIdentityLabel() {
    const identity = document.querySelector("#ctmflag-panel .ctmflag-identity");
    if (!identity) return;
    const name = readName();
    identity.textContent = name ? "You: " + name : "Set your name";
  }

  function renderPanel() {
    const list = document.querySelector("#ctmflag-panel .ctmflag-panel-list");
    if (!list) return;
    list.textContent = ""; // clear

    let flags = Array.from(flagsByCallId.values());

    // Open / Resolved / All filter.
    flags = flags.filter((f) => {
      const status = f.status || "open";
      if (inboxFilter === "open") return status !== "resolved";
      if (inboxFilter === "resolved") return status === "resolved";
      return true;
    });

    if (flags.length === 0) {
      const empty = el("div", "ctmflag-empty");
      if (!isReady()) {
        empty.textContent =
          "Firebase isn't set up yet — " + (getInitErrorMessage() || "");
      } else {
        empty.textContent =
          inboxFilter === "resolved" ? "No resolved tags." : "No tagged calls.";
      }
      list.appendChild(empty);
      return;
    }

    // Group by client; newest tag first within a group; groups ordered by their
    // newest tag.
    const groups = new Map(); // clientId -> { name, items: [] }
    flags.forEach((f) => {
      const cid = f.clientId || "unknown";
      if (!groups.has(cid)) {
        groups.set(cid, { name: f.clientName || "Unknown client", items: [] });
      }
      groups.get(cid).items.push(f);
    });

    const ordered = Array.from(groups.values()).map((g) => {
      g.items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      g.newest = g.items[0] ? g.items[0].timestamp || 0 : 0;
      return g;
    });
    ordered.sort((a, b) => b.newest - a.newest);

    ordered.forEach((g) => {
      // Show a client header only when more than one client is present, so a
      // single-account setup stays clean.
      if (groups.size > 1) {
        const head = el("div", "ctmflag-group-head");
        head.appendChild(el("span", "ctmflag-group-name", g.name));
        const unread = g.items.filter(
          (f) => (f.status || "open") !== "resolved" && isUnread(f)
        ).length;
        if (unread > 0) {
          head.appendChild(
            el("span", "ctmflag-group-unread", unread + " unread")
          );
        }
        list.appendChild(head);
      }
      g.items.forEach((flag) => list.appendChild(renderInboxItem(flag)));
    });
  }

  function renderInboxItem(flag) {
    const resolved = (flag.status || "open") === "resolved";
    const unread = !resolved && isUnread(flag);

    const item = el(
      "div",
      "ctmflag-item" + (unread ? " is-unread" : "") + (resolved ? " is-resolved" : "")
    );

    const top = el("div", "ctmflag-item-top");
    const byline = el("div", "ctmflag-item-byline");
    if (unread) byline.appendChild(el("span", "ctmflag-unread-dot"));
    byline.appendChild(el("span", "ctmflag-item-by", flag.flaggedBy || "Unknown"));
    if (resolved) byline.appendChild(el("span", "ctmflag-status-pill", "Resolved"));
    top.appendChild(byline);
    top.appendChild(el("span", "ctmflag-item-time", formatTime(flag.timestamp)));

    const note = el("div", "ctmflag-item-note", flag.note || "(no note added)");

    const actions = el("div", "ctmflag-item-actions");
    const go = el("button", "ctmflag-link", "→ Open call");
    go.type = "button";
    go.addEventListener("click", () => openCall(flag));

    const resolveBtn = el(
      "button",
      "ctmflag-action",
      resolved ? "Reopen" : "Resolve"
    );
    resolveBtn.type = "button";
    resolveBtn.addEventListener("click", async () => {
      resolveBtn.disabled = true;
      const ok = await setStatus(flag.callId, resolved ? "open" : "resolved");
      if (!ok) {
        resolveBtn.disabled = false;
        toast("Couldn't update — check console.");
      }
    });

    const remove = el("button", "ctmflag-remove", "✕");
    remove.type = "button";
    remove.title = "Delete permanently";
    remove.addEventListener("click", async () => {
      if (
        !window.confirm(
          "Delete this tag for everyone? This can't be undone.\n" +
            "(Resolve archives it instead — nothing is lost.)"
        )
      )
        return;
      remove.disabled = true;
      const ok = await removeFlag(flag.callId);
      if (!ok) {
        remove.disabled = false;
        toast("Couldn't remove — check console.");
      }
    });

    actions.appendChild(go);
    actions.appendChild(resolveBtn);
    actions.appendChild(remove);
    item.appendChild(top);
    item.appendChild(note);
    item.appendChild(actions);
    return item;
  }

  // From the inbox: jump to a call. If its row is on the current page, scroll +
  // highlight; otherwise navigate to its saved deep link. Either way, mark read.
  function openCall(flag) {
    markRead(flag.callId, getDeviceId());
    injectRowButtons();
    const target = findRowByCallId(flag.callId);
    if (target) {
      closePanel();
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("ctmflag-highlight");
      setTimeout(() => target.classList.remove("ctmflag-highlight"), 2000);
      return;
    }
    if (flag.callUrl) {
      location.href = flag.callUrl; // different client/page — navigate there
    } else {
      toast("Call " + flag.callId + " is on a different page — search for it.");
    }
  }

  function openPanel() {
    buildPanel();
    const panel = document.getElementById("ctmflag-panel");
    if (!panel) return;
    panel.classList.add("is-open");
    panelOpen = true;
    renderPanel();
  }
  function closePanel() {
    const panel = document.getElementById("ctmflag-panel");
    if (panel) panel.classList.remove("is-open");
    panelOpen = false;
  }
  function togglePanel() {
    if (panelOpen) closePanel();
    else openPanel();
  }

  /* ── "Go to call": scroll + highlight, or toast if off-page ─────────────── */

  function goToCall(callId) {
    // Make sure rows are tagged with their callId before we search.
    injectRowButtons();
    const target = findRowByCallId(callId);
    if (!target) {
      toast("Call " + callId + " may be on a different page — search for it.");
      return;
    }
    closePanel();
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("ctmflag-highlight");
    setTimeout(() => target.classList.remove("ctmflag-highlight"), 2000);
  }

  // Find the actual ROW element (not the button) for a callId.
  function findRowByCallId(callId) {
    const rows = findCallRows();
    for (const row of rows) {
      const id = row.getAttribute(ATTR_ROW_ID) || getCallId(row);
      if (id === callId) return row;
    }
    return null;
  }

  // Minimal CSS.escape fallback for older engines.
  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\\]]/g, "\\$&");
  }

  /* ── Real-time sync ─────────────────────────────────────────────────────── */

  function onFlagsUpdate(flags) {
    const map = new Map();
    flags.forEach((f) => {
      if (f && f.callId != null) map.set(String(f.callId), f);
    });
    flagsByCallId = map;

    updateBadge();
    updateAllButtonStates();
    if (panelOpen) renderPanel();

    // If an editor popover is open, redraw it so it reflects the new state
    // (e.g. a teammate just flagged/unflagged the same call). We rebuild in
    // place rather than via toggle so the popover doesn't flicker shut.
    if (openEditorEl) {
      const cid = openEditorEl.getAttribute("data-for");
      const btn = document.querySelector(
        "[" + ATTR_BTN + '][' + ATTR_ROW_ID + '="' + cssEscape(cid) + '"]'
      );
      if (btn) {
        closeEditor();
        toggleEditor(cid, btn);
      }
    }
  }

  /* ── Re-scan on AJAX (CTM loads call rows dynamically) ───────────────────── */

  let pending = false;
  function scheduleScan() {
    if (pending) return;
    pending = true;
    const run = () => {
      pending = false;
      injectToolbarButton();
      injectRowButtons();
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 500 });
    else setTimeout(run, 120);
  }

  function startObserver() {
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== "childList") continue;
        // Ignore mutations that are only our own injected nodes.
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.hasAttribute && n.hasAttribute(ATTR_BTN)) continue;
          if (n.id && String(n.id).startsWith("ctmflag")) continue;
          scheduleScan();
          return;
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* ── Boot ───────────────────────────────────────────────────────────────── */

  function start() {
    try {
      buildPanel();
      injectToolbarButton();
      injectRowButtons();
      startObserver();

      // Begin the real-time Firestore listener. If Firebase isn't configured,
      // this is a no-op and the UI simply shows the "set up Firebase" hint.
      subscribeFlags(onFlagsUpdate);

      if (!isReady()) {
        console.warn(
          "[CTM Tag] Firebase not ready: " +
            (getInitErrorMessage() || "unknown") +
            " — the UI loads but tags won't sync until you fill in src/firebase.config.js."
        );
      }
    } catch (err) {
      // Absolute last resort: never let our script break the CTM page.
      console.error("[CTM Tag] Fatal error during init (CTM page unaffected):", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

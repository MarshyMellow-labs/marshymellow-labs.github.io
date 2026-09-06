/* Device-local marshmallow hunt and the little corner companion. */
(function () {
  "use strict";
  const pages = [
    { id: "index", label: "Home", href: "index.html", spot: "#about .about-copy" },
    { id: "approved", label: "Approved", href: "approved.html", spot: ".approved-panel" },
    { id: "headset", label: "Headset", href: "headset.html", spot: ".tracking-copy" },
    { id: "games", label: "Games", href: "games.html", spot: ".games-heading" },
    { id: "control-marshy", label: "Marshy Zappy Zaps", href: "control-marshy.html", spot: "main" },
    { id: "donate", label: "Pay Tribute", href: "donate.html", spot: ".tribute-benefits" },
    { id: "projects", label: "Projects", href: "projects.html", spot: ".projects-note" }
  ];
  const key = "marshymellow-hunt-v1";
  function normalize(value) {
    return Array.isArray(value) ? [...new Set(value.filter(id => pages.some(page => page.id === id)))] : [];
  }
  function collect(found, id) { return normalize([...normalize(found), id]); }
  function readJourney(href) {
    try { return normalize((new URL(href).searchParams.get("snacks") || "").split(",")); }
    catch { return []; }
  }
  function journeyLink(href, currentHref, found) {
    const current = new URL(currentHref);
    const target = new URL(href, current);
    const directory = current.pathname.slice(0, current.pathname.lastIndexOf("/") + 1);
    const filename = target.pathname.slice(directory.length) || "index.html";
    if (target.origin !== current.origin || !target.pathname.startsWith(directory)
      || !pages.some(page => page.href === filename)) return href;
    const progress = normalize(found);
    if (progress.length) target.searchParams.set("snacks", progress.join(","));
    else target.searchParams.delete("snacks");
    return target.href;
  }
  function createPetReactions(host, pet) {
    let idleTimer, reactionTimer;
    function scheduleSleep() {
      host.clearTimeout(idleTimer);
      idleTimer = host.setTimeout(() => { pet.dataset.reaction = "sleeping"; }, 45000);
    }
    function react(reaction, duration) {
      host.clearTimeout(idleTimer);
      host.clearTimeout(reactionTimer);
      pet.dataset.reaction = reaction;
      reactionTimer = host.setTimeout(() => {
        pet.dataset.reaction = "awake";
        scheduleSleep();
      }, duration);
    }
    function activity() {
      if (pet.dataset.reaction === "sleeping") react("waving", 1000);
      else if (pet.dataset.reaction === "awake") scheduleSleep();
    }
    function stop() { host.clearTimeout(idleTimer); host.clearTimeout(reactionTimer); }
    pet.dataset.reaction = "awake";
    scheduleSleep();
    return { activity, celebrate: () => react("celebrating", 2500), stop };
  }
  // Keep the small state machine independently testable without a browser.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { pages, normalize, collect, readJourney, journeyLink, createPetReactions };
    return;
  }
  function init() {
    const pageId = document.documentElement.dataset.page;
    const page = pages.find(item => item.id === pageId);
    if (!page) return; // Only the seven hunt pages show the companion.
    const savedState = window.MarshyStorage;
    let found = [];
    let persistent = true;
    try { found = normalize(JSON.parse(savedState.getItem(key) || "[]")); }
    catch { persistent = false; }
    found = normalize([...found, ...readJourney(window.location.href)]);
    if (found.length) persistent = savedState.setItem(key, JSON.stringify(found));
    const companion = document.createElement("aside");
    companion.className = "marshy-companion";
    companion.setAttribute("aria-label", "Find the Marshys");
    companion.innerHTML = `<div class="marshy-bubble" id="marshy-hunt-panel" hidden>
      <div class="hunt-heading"><strong>Find the Marshys</strong><button type="button" class="hunt-close" aria-label="Close Find the Marshys">×</button></div>
      <p>Seven tiny Marshys are hiding around the site. Find them all to unlock a special picture.</p>
      <p class="hunt-count" role="status" aria-live="polite"></p>
      <progress class="hunt-progress" max="7" value="0" aria-label="Marshys found"></progress>
      <ul class="hunt-pages"></ul>
      <p class="hunt-storage">Your finds are saved on this device.</p>
      <div class="hunt-reward" hidden><strong>You found every little Marshy!</strong><p>A little rainbow just for you. Thanks for exploring my corner of the internet. ♡ — Marshy</p><a class="hunt-reward-link" href="assets/hunt-reward-rainbow.png" target="_blank" rel="noopener"><img class="hunt-reward-image" alt="Marshy beneath a double rainbow in a field of flowers" width="2560" height="1440"><span>Open your reward picture ↗</span></a></div>
    </div>
    <button type="button" class="mascot-toggle" aria-expanded="false" aria-controls="marshy-hunt-panel" aria-label="Open Find the Marshys">
      <span class="marshy-pet-sprite" aria-hidden="true"></span><span class="mascot-caption">psst…</span>
    </button>`;
    document.body.append(companion);
    const panel = companion.querySelector(".marshy-bubble");
    const toggle = companion.querySelector(".mascot-toggle");
    const reactions = createPetReactions(window, toggle);
    ["pointermove", "pointerdown", "keydown"].forEach(event => document.addEventListener(event, reactions.activity, { passive: true }));
    window.addEventListener("pagehide", reactions.stop);
    const count = companion.querySelector(".hunt-count");
    const list = companion.querySelector(".hunt-pages");
    const hiddenSnack = document.createElement("button");
    hiddenSnack.type = "button";
    hiddenSnack.className = "hidden-marshmallow";
    hiddenSnack.setAttribute("aria-label", "Find the hidden Marshy on " + (page?.label || "this page"));
    hiddenSnack.title = "A tiny Marshy?";
    hiddenSnack.innerHTML = '<span class="marshy-pet-sprite" aria-hidden="true"></span>';
    const spot = page ? document.querySelector(page.spot) || document.querySelector("main") : null;
    if (spot) spot.append(hiddenSnack);
    function setOpen(open) {
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", (open ? "Close" : "Open") + " Find the Marshys");
    }
    function render() {
      count.textContent = `${found.length} / ${pages.length} Marshys found`;
      companion.querySelector(".hunt-progress").value = found.length;
      companion.querySelector(".hunt-reward").hidden = found.length !== pages.length;
      if (found.length === pages.length) {
        companion.querySelector(".hunt-reward-image").src = "assets/hunt-reward-rainbow.png";
      }
      companion.querySelector(".hunt-storage").textContent = persistent
        ? "Your finds are saved on this device."
        : "Your finds travel with the page links. Bookmark this page to keep your progress.";
      companion.querySelector(".mascot-caption").textContent = found.length === pages.length ? "all found! ♡" : found.length ? `${found.length} / ${pages.length}` : "psst…";
      hiddenSnack.disabled = found.includes(pageId);
      hiddenSnack.classList.toggle("is-collected", hiddenSnack.disabled);
      hiddenSnack.title = hiddenSnack.disabled ? "Already found!" : "A tiny Marshy?";
      list.replaceChildren();
      pages.forEach(item => {
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = item.href;
        link.textContent = (found.includes(item.id) ? "✓ " : "○ ") + item.label;
        link.setAttribute("aria-label", item.label + (found.includes(item.id) ? ", found" : ", still hiding"));
        li.append(link); list.append(li);
      });
      // Also carry progress in same-site links: some embedded previews discard
      // otherwise successful storage writes when navigating to another document.
      document.querySelectorAll("a[href]").forEach(link => {
        link.href = journeyLink(link.getAttribute("href"), window.location.href, found);
      });
      if (found.length) {
        try { window.history.replaceState(window.history.state, "", journeyLink(window.location.href, window.location.href, found)); }
        catch { /* The decorated page links still retain progress. */ }
      }
    }
    toggle.addEventListener("click", () => setOpen(panel.hidden));
    companion.querySelector(".hunt-close").addEventListener("click", () => { setOpen(false); toggle.focus(); });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !panel.hidden) { setOpen(false); toggle.focus(); }
    });
    hiddenSnack.addEventListener("click", () => {
      try {
        const saved = normalize(JSON.parse(savedState.getItem(key) || "[]"));
        found = normalize([...found, ...saved]);
      }
      catch { persistent = false; }
      found = collect(found, pageId);
      try { persistent = savedState.setItem(key, JSON.stringify(found)); } catch { persistent = false; }
      render(); reactions.celebrate(); setOpen(true); companion.querySelector(".hunt-close").focus();
    });
    window.addEventListener("storage", event => {
      if (event.key !== key && event.key !== null) return;
      try { found = normalize(JSON.parse(savedState.getItem(key) || "[]")); } catch { found = []; }
      render();
    });
    window.addEventListener("pageshow", () => {
      toggle.dataset.reaction = "awake";
      reactions.activity();
      let saved = [];
      try { saved = normalize(JSON.parse(savedState.getItem(key) || "[]")); } catch { /* Keep this page's finds. */ }
      found = normalize([...found, ...saved, ...readJourney(window.location.href)]);
      render();
    });
    render();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
}());

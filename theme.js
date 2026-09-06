(function () {
  const storageKey = "marshymellow-theme";
  const root = document.documentElement;
  const pageName = (window.location.pathname.split("/").pop() || "index.html")
    .replace(/\.html$/i, "") || "index";
  const savedState = window.MarshyStorage;

  if (pageName === "snake" || pageName === "dungeon") {
    window.location.replace("games.html#" + pageName);
    return;
  }

  function storedTheme() {
    try {
      return savedState.getItem(storageKey);
    } catch (error) {
      return null;
    }
  }

  function preferredTheme() {
    const saved = storedTheme();
    return saved === "light" || saved === "dark"
      ? saved
      : "dark";
  }

  function updateButton(button, theme) {
    const nextTheme = theme === "dark" ? "light" : "dark";
    button.setAttribute("aria-label", `Switch to ${nextTheme} mode`);
    button.setAttribute("aria-pressed", String(theme === "dark"));
    button.title = `Switch to ${nextTheme} mode`;
  }

  function applyTheme(theme, savePreference) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;

    if (savePreference) {
      try {
        savedState.setItem(storageKey, theme);
      } catch (error) {
        // The theme still works when storage is unavailable.
      }
    }

    const button = document.querySelector(".theme-toggle");
    if (button) {
      updateButton(button, theme);
    }

    window.dispatchEvent(new CustomEvent("marshy-theme-change", {
      detail: { theme }
    }));
  }

  function installToggle() {
    const button = document.createElement("button");
    const icon = document.createElement("span");
    const nav = document.querySelector(".nav-links");
    const header = document.querySelector(".site-header");

    button.className = "theme-toggle";
    button.type = "button";
    icon.className = "theme-toggle-icon";
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
    updateButton(button, root.dataset.theme);

    button.addEventListener("click", function () {
      applyTheme(root.dataset.theme === "dark" ? "light" : "dark", true);
    });

    if (nav) {
      nav.append(button);
    } else if (header) {
      const actions = document.createElement("div");
      const existingAction = header.querySelector(":scope > .button");
      actions.className = "theme-header-actions";

      if (existingAction) {
        actions.append(existingAction);
      }

      actions.append(button);
      header.append(actions);
    } else {
      button.classList.add("theme-toggle-floating");
      document.body.append(button);
    }
  }


  function synchronizeNavigation(nav) {
    const destinations = [
      ["index.html#about", "About"], ["index.html#pictures", "Pictures"],
      ["index.html#tos", "Marshys TOS"], ["approved.html", "Approved"],
      ["headset.html", "Headset"], ["games.html", "Games"],
      ["control-marshy.html", "Marshy Zappy Zaps"], ["projects.html", "Projects"],
      ["donate.html", "Pay Tribute"]
    ];
    function destinationKey(href) {
      const url = new URL(href, window.location.href);
      return url.origin + url.pathname + url.hash;
    }
    const legacy = ["snake.html", "dungeon.html"].map(destinationKey);
    Array.from(nav.querySelectorAll("a")).forEach(link => {
      if (legacy.includes(destinationKey(link.href))) link.remove();
    });
    destinations.forEach(([href, label]) => {
      // Progress parameters and absolute URLs do not make a new destination.
      const matches = Array.from(nav.querySelectorAll("a"))
        .filter(item => destinationKey(item.href) === destinationKey(href));
      const link = matches.shift() || document.createElement("a");
      matches.forEach(duplicate => duplicate.remove());
      if (!link.getAttribute("href")) link.href = href;
      link.textContent = label;
      if (!href.includes("#") && href === pageName + ".html") link.setAttribute("aria-current", "page");
      nav.append(link);
    });
    const themeButton = nav.querySelector(".theme-toggle");
    if (themeButton) nav.append(themeButton);
  }

  function installNavigation() {
    const header = document.querySelector(".site-header");
    const nav = document.querySelector(".nav-links");
    if (!header || !nav) return;
    synchronizeNavigation(nav);
    if (header.querySelector(".nav-menu-toggle")) return;

    const button = document.createElement("button");
    const lines = document.createElement("span");

    if (!nav.id) {
      nav.id = "main-navigation";
    }

    button.className = "nav-menu-toggle";
    button.type = "button";
    button.setAttribute("aria-controls", nav.id);
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Open navigation");
    lines.className = "nav-menu-toggle-lines";
    lines.setAttribute("aria-hidden", "true");
    button.append(lines);
    header.insertBefore(button, nav);
    root.classList.add("nav-enhanced");

    function setMenu(open) {
      nav.dataset.open = String(open);
      button.setAttribute("aria-expanded", String(open));
      button.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    }

    button.addEventListener("click", function () {
      setMenu(button.getAttribute("aria-expanded") !== "true");
    });

    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) {
        setMenu(false);
      }
    });

    document.addEventListener("click", function (event) {
      if (!header.contains(event.target)) {
        setMenu(false);
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        setMenu(false);
        button.focus();
      }
    });

    window.matchMedia("(min-width: 1601px)").addEventListener("change", function (event) {
      if (event.matches) {
        setMenu(false);
      }
    });
  }

  function installHeartRate() {
    const group = document.createElement("div");
    const indicator = document.createElement("a");
    const value = document.createElement("strong");
    const location = document.createElement("span");
    const locationLabel = document.createElement("span");
    const locationCount = document.createElement("strong");
    const header = document.querySelector(".site-header");
    const nav = document.querySelector(".nav-links");
    const heartEndpoint = "https://hnqrptrfxxtuxhawyvge.supabase.co/rest/v1/rpc/get_marshy_control_state";
    const statusEndpoint = "https://hnqrptrfxxtuxhawyvge.supabase.co/rest/v1/rpc/get_public_marshy_summary";
    const publishableKey = "sb_publishable_anROZEas9WH0SKrywRbG9Q_1zywb3ia";

    group.className = "site-live-status";
    indicator.className = "site-heart-rate";
    indicator.href = "control-marshy.html";
    indicator.setAttribute("aria-label", "Marshy's heart rate: checking");
    indicator.setAttribute("aria-live", "polite");
    indicator.innerHTML = '<span class="site-heart-icon" aria-hidden="true">♥</span><span class="site-heart-label">Marshy</span>';
    value.className = "site-heart-value";
    value.textContent = "—";
    indicator.append(value, document.createTextNode(" BPM"));
    location.className = "site-location-status";
    location.dataset.state = "unknown";
    location.setAttribute("aria-label", "Marshy's location: checking");
    location.setAttribute("aria-live", "polite");
    location.innerHTML = '<span class="site-location-icon" aria-hidden="true">●</span>';
    locationLabel.className = "site-location-label";
    locationLabel.textContent = "Checking…";
    locationCount.className = "site-location-count";
    locationCount.hidden = true;
    location.append(locationLabel, locationCount);
    group.append(indicator, location);

    if (header) {
      header.insertBefore(group, nav || header.lastElementChild);
    } else {
      group.classList.add("site-live-status-floating");
      document.body.append(group);
    }

    const requestHeaders = {
      apikey: publishableKey,
      Authorization: "Bearer " + publishableKey,
      "Content-Type": "application/json"
    };

    async function refreshHeartRate() {
      if (document.hidden) {
        return;
      }

      try {
        const response = await fetch(heartEndpoint, {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify({ control_session_id: null })
        });

        if (!response.ok) {
          throw new Error("Heart-rate request failed");
        }

        const state = await response.json();
        const live = state?.heart_rate_status === "live" && Number.isInteger(state?.heart_rate);
        value.textContent = live ? String(state.heart_rate) : "—";
        indicator.dataset.live = String(live);
        indicator.setAttribute(
          "aria-label",
          live
            ? "Marshy's heart rate: " + state.heart_rate + " beats per minute"
            : "Marshy's heart rate is unavailable"
        );
        indicator.title = live ? state.heart_rate + " BPM" : "Heart rate unavailable";
      } catch (error) {
        value.textContent = "—";
        indicator.dataset.live = "false";
        indicator.setAttribute("aria-label", "Marshy's heart rate is unavailable");
        indicator.title = "Heart rate unavailable";
      }
    }

    function renderLocation(status) {
      const state = typeof status?.state === "string" ? status.state : "unknown";
      const world = typeof status?.world_name === "string" ? status.world_name.trim() : "";
      const reportedCount = status?.player_count;
      const playerCount = Number.isInteger(reportedCount) && reportedCount >= 0
        ? reportedCount
        : null;
      const showCount = (state === "public" || (state === "private" && Boolean(world))) && playerCount !== null;
      const labels = {
        public: world || "In VRChat",
        private: world || "Private world",
        traveling: "Changing worlds",
        online: "VRChat online",
        offline: "VRChat offline",
        unknown: "Location unavailable"
      };
      const label = labels[state] || labels.unknown;
      const homeLabel = document.querySelector("#home-status-label");
      const homeDetail = document.querySelector("#home-status-detail");
      if (homeLabel && homeDetail) {
        const homeLabels = {
          public: world ? "Marshy is exploring " + world : "Marshy is exploring VRChat",
          private: world ? "Marshy is exploring " + world : "Marshy is hiding",
          traveling: "Marshy is hopping between worlds",
          online: "Marshy is in VRChat",
          offline: "Marshy has escaped VRChat",
          unknown: "Nobody knows where Marshy is"
        };
        homeLabel.textContent = homeLabels[state] || homeLabels.unknown;
        homeLabel.closest(".home-marshy-status").dataset.state = state;
        homeDetail.textContent = showCount
          ? `${playerCount} ${playerCount === 1 ? "player" : "players"} in this instance. Updated automatically.`
          : state === "private" && !world ? "Tucked away somewhere cosy."
          : state === "unknown" ? "No fresh status right now. Check back in a little while."
          : (state === "public" || state === "private") ? "Player count unavailable. Waiting for the next update."
          : "A little glimpse of what Marshy is up to.";
      }

      location.dataset.state = state;
      locationLabel.textContent = label;
      locationCount.hidden = !showCount;
      locationCount.textContent = showCount ? String(playerCount) : "";
      locationCount.title = showCount
        ? `${playerCount} ${playerCount === 1 ? "player" : "players"}`
        : "";
      location.title = label;
      location.setAttribute(
        "aria-label",
        showCount
          ? `Marshy's location: ${label}; ${playerCount} ${playerCount === 1 ? "player" : "players"}`
          : `Marshy's location: ${label}`
      );
    }

    async function refreshLocation() {
      if (document.hidden) {
        return;
      }

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(statusEndpoint, {
          method: "POST",
          headers: requestHeaders,
          body: "{}",
          cache: "no-store",
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("Location request failed");
        }

        const data = await response.json();
        renderLocation(Array.isArray(data) ? data[0] || null : data);
      } catch (error) {
        renderLocation(null);
      } finally {
        window.clearTimeout(timeout);
      }
    }

    refreshHeartRate();
    refreshLocation();
    window.setInterval(refreshHeartRate, 5000);
    window.setInterval(refreshLocation, 30000);
    document.addEventListener("visibilitychange", function () {
      refreshHeartRate();
      refreshLocation();
    });
  }

  function installScrollMotion() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const targets = document.querySelectorAll([
      ".hero-copy",
      ".hero-photo",
      ".section-header",
      ".about-copy",
      ".tos-text",
      ".approved-shell > h1",
      ".approved-shell > .intro",
      ".approved-panel",
      ".donate-shell > div",
      ".kofi-embed-card",
      ".tribute-benefits",
      ".game-copy",
      ".game-panel",
      ".leaderboard-panel",
      ".intro-copy",
      ".tracking-copy",
      ".gallery-heading",
      ".where-shell .title-block",
      ".status-portrait",
      ".status-panel"
    ].join(","));

    if (!targets.length || !("IntersectionObserver" in window)) {
      return;
    }

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, {
      rootMargin: "0px 0px -8% 0px",
      threshold: 0.08
    });

    targets.forEach(function (target) {
      target.classList.add("marshy-reveal");

      if (target.getBoundingClientRect().top < window.innerHeight * 0.94) {
        target.classList.add("is-visible");
      } else {
        observer.observe(target);
      }
    });
  }

  function installSectionTracking() {
    if (pageName !== "index") {
      return;
    }

    const links = Array.from(document.querySelectorAll('.nav-links a')).filter(link => {
      const url = new URL(link.href, window.location.href);
      return url.pathname === new URL("index.html", window.location.href).pathname && url.hash;
    });
    const pairs = links.map(function (link) {
      const hash = new URL(link.href, window.location.href).hash;
      return {
        link: link,
        section: hash ? document.querySelector(hash) : null
      };
    }).filter(function (pair) {
      return pair.section;
    });

    if (!pairs.length || !("IntersectionObserver" in window)) {
      return;
    }

    function markCurrent(section) {
      pairs.forEach(function (pair) {
        if (pair.section === section) {
          pair.link.setAttribute("aria-current", "location");
        } else {
          pair.link.removeAttribute("aria-current");
        }
      });
    }

    const observer = new IntersectionObserver(function (entries) {
      const visible = entries
        .filter(function (entry) { return entry.isIntersecting; })
        .sort(function (a, b) {
          return Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top);
        });

      if (visible[0]) {
        markCurrent(visible[0].target);
      }
    }, {
      rootMargin: "-16% 0px -62% 0px",
      threshold: 0
    });

    pairs.forEach(function (pair) {
      observer.observe(pair.section);
    });
  }

  function initializeUi() {
    installHeartRate();
    installToggle();
    installNavigation();
    installScrollMotion();
    installSectionTracking();
  }

  root.dataset.page = pageName;
  applyTheme(preferredTheme(), false);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeUi, { once: true });
  } else {
    initializeUi();
  }

  window.addEventListener("pageshow", () => applyTheme(preferredTheme(), false));
  window.addEventListener("storage", event => {
    if (event.key === storageKey || event.key === null) applyTheme(preferredTheme(), false);
  });

}());

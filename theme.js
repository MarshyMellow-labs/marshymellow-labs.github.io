(function () {
  const storageKey = "marshymellow-theme";
  const root = document.documentElement;
  const pageName = (window.location.pathname.split("/").pop() || "index.html")
    .replace(/\.html$/i, "") || "index";
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function storedTheme() {
    try {
      return window.localStorage.getItem(storageKey);
    } catch (error) {
      return null;
    }
  }

  function preferredTheme() {
    const saved = storedTheme();
    return saved === "light" || saved === "dark"
      ? saved
      : mediaQuery.matches ? "dark" : "light";
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
        window.localStorage.setItem(storageKey, theme);
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


  function installNavigation() {
    const header = document.querySelector(".site-header");
    const nav = document.querySelector(".nav-links");

    if (!header || !nav) {
      return;
    }

    if (!nav.querySelector('a[href="where-is-marshy.html"]')) {
      const statusLink = document.createElement("a");
      const headsetLink = nav.querySelector('a[href="headset.html"]');
      statusLink.href = "where-is-marshy.html";
      statusLink.textContent = "Where is Marshy?";

      if (headsetLink) {
        nav.insertBefore(statusLink, headsetLink);
      } else {
        nav.append(statusLink);
      }
    }

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

    window.matchMedia("(min-width: 1221px)").addEventListener("change", function (event) {
      if (event.matches) {
        setMenu(false);
      }
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

    const links = Array.from(document.querySelectorAll('.nav-links a[href*="index.html#"]'));
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

  mediaQuery.addEventListener("change", function (event) {
    if (!storedTheme()) {
      applyTheme(event.matches ? "dark" : "light", false);
    }
  });

}());

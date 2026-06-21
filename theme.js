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

  root.dataset.page = pageName;
  applyTheme(preferredTheme(), false);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installToggle, { once: true });
  } else {
    installToggle();
  }

  mediaQuery.addEventListener("change", function (event) {
    if (!storedTheme()) {
      applyTheme(event.matches ? "dark" : "light", false);
    }
  });
}());

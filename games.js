(function () {
  "use strict";

  const tabs = Array.from(document.querySelectorAll("[data-game-tab]"));
  const panels = Array.from(document.querySelectorAll("[data-game-panel]"));

  function selectGame(game, updateHash) {
    const selected = game === "dungeon" ? "dungeon" : "snake";

    tabs.forEach(function (tab) {
      const active = tab.dataset.gameTab === selected;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });

    panels.forEach(function (panel) {
      panel.hidden = panel.dataset.gamePanel !== selected;
    });

    document.dispatchEvent(new CustomEvent("marshy-game-selected", {
      detail: selected
    }));

    if (updateHash) {
      window.history.replaceState(null, "", "#" + selected);
    }
  }

  tabs.forEach(function (tab, index) {
    tab.addEventListener("click", function () {
      selectGame(tab.dataset.gameTab, true);
    });

    tab.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      event.preventDefault();
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(index + offset + tabs.length) % tabs.length];
      next.focus();
      selectGame(next.dataset.gameTab, true);
    });
  });

  window.addEventListener("hashchange", function () {
    selectGame(window.location.hash.slice(1), false);
  });

  selectGame(window.location.hash.slice(1), false);
}());
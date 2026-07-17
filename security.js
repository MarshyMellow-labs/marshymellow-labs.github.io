(() => {
  "use strict";

  if (window.top !== window.self) {
    document.documentElement.hidden = true;

    try {
      window.top.location = window.self.location.href;
    } catch {
      // A sandboxed cross-origin frame cannot be navigated, so keep this page hidden.
    }

    return;
  }

  document.addEventListener("error", (event) => {
    const image = event.target;

    if (!(image instanceof HTMLImageElement)) {
      return;
    }

    const fallbackSource = image.dataset.fallbackSrc;

    if (fallbackSource) {
      delete image.dataset.fallbackSrc;
      image.src = fallbackSource;
      return;
    }

    if (image.dataset.fallbackAction === "hide") {
      image.hidden = true;
      return;
    }

    if (image.dataset.fallbackAction === "hide-show-next") {
      image.hidden = true;

      if (image.nextElementSibling instanceof HTMLElement) {
        image.nextElementSibling.style.display = "inline";
      }
    }
  }, true);
})();

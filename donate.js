(() => {
  "use strict";

  const copyButton = document.querySelector("[data-copy-litecoin]");
  const address = document.getElementById("litecoin-wallet-address");
  const status = document.getElementById("litecoin-copy-status");

  if (!(copyButton instanceof HTMLButtonElement) || !address || !status) return;

  const defaultLabel = copyButton.textContent;

  copyButton.addEventListener("click", async () => {
    const value = address.textContent.trim();

    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(value);
      copyButton.textContent = "Copied!";
      status.textContent = "Litecoin address copied.";
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(address);
      selection?.removeAllRanges();
      selection?.addRange(range);
      status.textContent = "Copy was blocked, so the address has been selected.";
    }

    window.setTimeout(() => {
      copyButton.textContent = defaultLabel;
      status.textContent = "";
    }, 3000);
  });
})();

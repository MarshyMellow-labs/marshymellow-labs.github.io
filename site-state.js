/* Shared, device-local preferences with a site-wide cookie fallback. */
(function () {
  "use strict";
  function createStorage(host) {
    const memory = new Map();
    const cookieName = key => "marshy_" + encodeURIComponent(key);
    function readCookie(key) {
      try {
        const prefix = cookieName(key) + "=";
        const match = host.document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith(prefix));
        return match ? decodeURIComponent(match.slice(prefix.length)) : null;
      } catch { return null; }
    }
    function getItem(key) {
      const cookie = readCookie(key);
      if (cookie !== null) return cookie;
      try {
        const value = host.localStorage.getItem(key);
        if (value !== null) return value;
      } catch { /* Some preview browsers disable local storage. */ }
      try {
        const value = host.sessionStorage.getItem(key);
        if (value !== null) return value;
      } catch { /* Fall back to the current page. */ }
      return memory.get(key) ?? null;
    }
    function setItem(key, value) {
      value = String(value);
      memory.set(key, value);
      let saved = false;
      try {
        host.localStorage.setItem(key, value);
        saved = host.localStorage.getItem(key) === value;
      } catch { /* Try the site-wide cookie next. */ }
      try {
        host.document.cookie = cookieName(key) + "=" + encodeURIComponent(value)
          + "; Path=/; Max-Age=31536000; SameSite=Lax"
          + (host.location.protocol === "https:" ? "; Secure" : "");
        saved = readCookie(key) === value || saved;
      } catch { /* Session storage may still work. */ }
      try {
        host.sessionStorage.setItem(key, value);
        saved = host.sessionStorage.getItem(key) === value || saved;
      } catch { /* The caller can explain that saving is unavailable. */ }
      return saved;
    }
    return { getItem, setItem };
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createStorage };
  } else {
    window.MarshyStorage = createStorage(window);
  }
}());

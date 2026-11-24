// Inline scripts that must run before the app (and before the router reads the address). Kept as plain strings so tests can check them.

/**
 * Old addresses were hash addresses (`/#/expenses`). Bookmarks and the installed PWA still open them, so once, before the router starts, the
 * path inside the hash becomes the real path (`/expenses`). A hash that is not a path (`#top`) is left alone. DECISIONS D5.
 */
export const LEGACY_HASH_SCRIPT = `(function(){try{var h=location.hash;if(h&&h.indexOf('#/')===0){history.replaceState(null,'',h.slice(1))}}catch(e){}})();`;

/**
 * The theme before first paint, so a light-theme user does not see a dark flash. Reads the same stored settings the app reads (`hisaab:settings`);
 * dark is the default, as in the old index.html. Any problem leaves the default.
 */
export const EARLY_THEME_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem('hisaab:settings')||'null');var t=s&&s.theme==='light'?'light':'dark';document.documentElement.setAttribute('data-theme',t)}catch(e){}})();`;

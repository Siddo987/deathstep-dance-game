import React, { useEffect, useState } from 'react';

// This app has no real router (see App.jsx's own long-standing comment on
// that) - it's ~13 flat top-level pages, branched on window.location.pathname
// directly, and every internal link was a plain <a href> doing a genuine
// full-page navigation. That's simple, but it's also exactly why switching
// pages used to make the *entire* page flash blank for a beat (unmount every
// last DOM node, re-fetch index.html, re-parse/re-run every script) even
// between two pages sharing the same header/shell - reported as wanting
// dynamic, partial-page transitions instead (e.g. like todo.sidowski.de).
//
// Rather than pulling in a routing library for 13 flat pages, this is the
// minimal piece that was actually missing: a way to change
// window.location.pathname WITHOUT a real navigation, plus something for
// App.jsx to re-render off of when that happens. Everything else (the actual
// per-path branches, each page's own JSX) stays exactly as it was - only the
// `window.location.pathname === '/x'` reads at the top of each branch move to
// reading this hook's return value instead, and outbound <a href="/x">'s
// become <Link to="/x">.
const NAVIGATE_EVENT = 'deathstep-navigate';

// Changes the URL and notifies every usePathname() subscriber, without a
// real page load. Same-path calls (a link back to where you already are)
// are a no-op - pushState would otherwise pile up a dead history entry the
// back button has to click through for nothing.
export function navigate(path) {
  if (window.location.pathname === path) return;
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

// Single source of truth for "which page is this" - subscribes to both the
// browser's own back/forward navigation (popstate) and this module's own
// navigate() above (the synthetic event, since pushState itself fires
// neither popstate nor anything else observable).
export function usePathname() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  useEffect(() => {
    const onChange = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onChange);
    window.addEventListener(NAVIGATE_EVENT, onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener(NAVIGATE_EVENT, onChange);
    };
  }, []);
  return pathname;
}

// Drop-in replacement for a plain <a href="/x"> to one of this app's own
// pages - keeps the real href (so middle-click/ctrl-click/"open in new tab"/
// hovering-shows-the-URL all still work exactly like a normal link) but
// intercepts a plain left-click to navigate() instead of letting the browser
// actually load a new page. Anything that isn't a plain, unmodified left
// click (a modifier key held, or a non-primary mouse button) falls through
// to the browser's own default handling untouched.
export function Link({ to, onClick, ...props }) {
  const handleClick = (e) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handleClick} {...props} />;
}

import React, { useEffect, useState } from 'react';
import logo from './logo.png';

// Brief logo/name splash shown once per browser tab - this module only ever
// mounts once, from main.jsx, and nothing about router.jsx's client-side
// navigation (see App.jsx's usePathname) ever remounts it either, since that
// only swaps which branch renders *inside* the already-mounted App tree.
// Only an actual full reload (typing/bookmarking a URL, hitting refresh, or
// the one deliberate window.location.href left in Settings.jsx's account
// deletion) re-runs this module at all. Purely cosmetic and non-blocking:
// `pointerEvents: none` + the short timers below mean it never delays the
// app underneath from loading/rendering, it just visually covers it for a
// moment.
//
// "Once per tab" == sessionStorage. Two throttling schemes were tried and
// both turned out wrong for this app specifically, in opposite directions:
//
// - v1 (localStorage timestamp, 2h cooldown): meant to allow re-showing
//   after real time had passed, but every one of this site's "other pages"
//   (Settings/Datenschutz/Feedback/etc.) was, at the time, a plain <a href>
//   to a different path - a genuine full page reload, before router.jsx
//   existed. Reported as "wird nie angezeigt": anyone clicking between
//   pages, or just reloading, more than once in 2h - which in practice is
//   everyone - landed inside the cooldown almost every time.
// - v2 (no storage at all, unconditional): fixed that, but then showed on
//   *every single* page load again, including the exact same-tab page-to-
//   page navigations above and plain refreshes - reported as "wird jetzt
//   immer angezeigt".
//
// sessionStorage is the actual right tool here, not a worse localStorage:
// it's shared across every same-tab navigation (survives the full-page
// reloads above, so those don't retrigger it) while still being fresh for a
// genuinely new tab/window. The one known gap (Chrome "continue where you
// left off" / Firefox "restore previous session" carrying it across a full
// browser restart) means an already-dismissed splash sometimes won't show
// again right after such a restore - a much smaller miss than either
// previous version's, and not worth reintroducing a wall-clock cooldown for.
// 650ms/300ms (950ms total) turned out too short to reliably register at
// all on a real first load - the network fetch for logo.png alone can eat
// into that window on a cold cache, and reports kept coming back as "never
// shows" rather than "shows too briefly", suggesting most users never
// consciously caught it even once. Long enough to actually be seen, still
// short enough to read as a flourish rather than a delay.
const VISIBLE_MS = 1400;
const FADE_MS = 400;
const SESSION_KEY = 'deathstep_splash_shown';

function shouldShowSplash() {
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return false;
    sessionStorage.setItem(SESSION_KEY, '1');
    return true;
  } catch {
    // Privacy mode / storage disabled - fail open, it's harmless cosmetics.
    return true;
  }
}

// Temporary diagnostic escape hatch for the "sessionStorage key gets set but
// nothing ever visibly appears" report, confirmed live 2026-08-18: with
// ?splashDebug=1 (stays up forever, see below) the overlay renders and is
// visible - proven in DevTools - but the real timed flow (even at the new
// 1400ms) still shows nothing on a genuinely fresh session. Since that rules
// out both "not actually rendering" and "just too short a window", this
// mode adds a way to test the *timed* path repeatably too, without needing
// a fresh incognito window every single time (which also bypasses
// sessionStorage entirely, not just when forced permanently visible):
// - ?splashDebug=1        - stays up forever (unchanged, for DOM/CSS inspection)
// - ?splashDebug=<number> - runs the real fade-in/out timing using that many
//                           ms as VISIBLE_MS, every reload, ignoring the
//                           once-per-tab flag - for comparing "does a much
//                           longer timed window actually get seen" against
//                           the real 1400ms default.
// Remove once the real cause is found.
function getSplashDebugParam() {
  try {
    return new URLSearchParams(window.location.search).get('splashDebug');
  } catch {
    return null;
  }
}

function Splash() {
  const debugParam = getSplashDebugParam();
  const forceVisible = debugParam === '1';
  const debugVisibleMs = debugParam && !forceVisible && !Number.isNaN(Number(debugParam)) ? Number(debugParam) : null;
  const effectiveVisibleMs = debugVisibleMs ?? VISIBLE_MS;
  const [phase, setPhase] = useState(() => (forceVisible || debugVisibleMs !== null || shouldShowSplash() ? 'visible' : 'hidden'));

  useEffect(() => {
    if (forceVisible) return; // stays 'visible' forever - no timers at all
    // Empty deps: run once at mount only, reading the phase the initializer
    // above already decided - if this tab already showed it, phase starts
    // (and stays) 'hidden', no timers at all. (Deliberately not depending on
    // `phase` here: that would clear the still-pending hideTimer the moment
    // fadeTimer fires and flips phase to 'fading', leaving the splash stuck
    // mid-fade forever.)
    if (phase !== 'visible') return;
    const fadeTimer = setTimeout(() => setPhase('fading'), effectiveVisibleMs);
    const hideTimer = setTimeout(() => setPhase('hidden'), effectiveVisibleMs + FADE_MS);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'hidden') return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        // Must outrank .cookie-banner (z-index 10000, see index.css) - a
        // genuinely fresh visit (no consent decision stored yet) is exactly
        // when *both* this splash and the cookie banner want to show at
        // once, and the banner can cover up to 80vh from the bottom on a
        // small phone. At 9999 this sat fully behind it and was invisible
        // on precisely the visits it was supposed to appear on - the same
        // stacking mistake .modal-overlay's own comment already documents
        // once before (there it broke clicks; here it just hid the splash
        // entirely, which is why lowering the *frequency* it shows at never
        // fixed anything - it was never a timing/storage bug at all).
        // One above .modal-overlay's own 10001 too: those are portaled to
        // document.body, i.e. *after* #root in DOM order, so an equal
        // z-index would let any modal already open at load (a restored
        // view's alert, say) paint over the splash instead of under it.
        zIndex: 10002,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '18px',
        background: 'radial-gradient(circle at 50% 40%, rgba(181,43,255,0.18) 0%, var(--bg-dark) 70%)',
        opacity: phase === 'fading' ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: 'none',
      }}
    >
      <img
        src={logo}
        alt=""
        width={96}
        height={100}
        style={{ filter: 'drop-shadow(0 0 14px var(--neon-purple))' }}
      />
      <h1 className="glitch-text" style={{ fontSize: '2rem', margin: 0, color: 'var(--text-main)' }}>Deathstep</h1>
    </div>
  );
}

export default Splash;

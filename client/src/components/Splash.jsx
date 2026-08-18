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
//
// v4 (2026-08-18) fixed the real bug: it never showed *at all*, for anyone,
// confirmed live. Two independent causes stacked on top of each other:
//
// 1. shouldShowSplash() below both *read and wrote* the sessionStorage flag
//    inside useState's lazy initializer. React.StrictMode intentionally
//    double-invokes state initializers in development to catch exactly this
//    kind of impurity - the first call would set the flag, and the second
//    call (whose result React actually keeps) would then see it already set
//    and return false. The production build should never hit that, since
//    StrictMode's double-invoking is a dev-only check... except this app's
//    production build was accidentally shipping React's *development*
//    bundle the whole time (see root /.env's NODE_ENV, now fixed) - so this
//    was firing for every real visitor, not just in local dev. Split the
//    read from the write below so the initializer is pure regardless.
// 2. The overlay's background was a radial-gradient - reliable everywhere
//    tested in isolation, but confirmed (via an isolated repro) to fail to
//    paint, or paint with visible banding, specifically when stacked over
//    another radial-gradient background (this app's <body>, see index.css).
//    A real Chromium compositor bug, not anything in this component's logic
//    - every DOM/computed-style check looked perfect while it silently
//    painted nothing. Switched to a solid color + inset box-shadow glow,
//    which has no such interaction.
//
// Bug #1 alone was enough to hide it completely, so #2 was never actually
// visible to a real user - but both are fixed, since #2 would have caused
// exactly the same "shows nothing" symptom the moment #1 was fixed.
const VISIBLE_MS = 1400;
const FADE_MS = 400;
const SESSION_KEY = 'deathstep_splash_shown';

// Pure read - never writes. Safe to call from a state initializer even if
// React invokes it more than once (StrictMode dev checks, or otherwise).
function wasSplashAlreadyShown() {
  try {
    return !!sessionStorage.getItem(SESSION_KEY);
  } catch {
    // Privacy mode / storage disabled - treat as "not shown" (fail open,
    // it's harmless cosmetics either way).
    return false;
  }
}

function markSplashShown() {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    /* ignored - see wasSplashAlreadyShown's fail-open comment */
  }
}

function Splash() {
  const [phase, setPhase] = useState(() => (wasSplashAlreadyShown() ? 'hidden' : 'visible'));

  useEffect(() => {
    // Empty deps: run once at mount only. (Deliberately not depending on
    // `phase` here: that would clear the still-pending hideTimer the moment
    // fadeTimer fires and flips phase to 'fading', leaving the splash stuck
    // mid-fade forever.)
    if (phase !== 'visible') return;
    // The actual "mark as shown" write happens here, in the effect, not in
    // the state initializer above - effects only ever run once per real
    // commit (even StrictMode's dev double-invoke immediately cleans the
    // first one up before the second runs), so this is the safe place for
    // the one-time side effect the read above deliberately doesn't do.
    markSplashShown();
    const fadeTimer = setTimeout(() => setPhase('fading'), VISIBLE_MS);
    const hideTimer = setTimeout(() => setPhase('hidden'), VISIBLE_MS + FADE_MS);
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
        // Solid color, deliberately not a radial-gradient - see the v4
        // comment up top for why a gradient here silently fails to paint.
        background: 'var(--bg-dark)',
        boxShadow: 'inset 0 0 120px rgba(181,43,255,0.25)',
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

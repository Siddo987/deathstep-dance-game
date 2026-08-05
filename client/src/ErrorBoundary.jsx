import React from 'react';

// Last-resort catch-all for any render error anywhere in the tree - without
// this, React just unmounts the whole app back to nothing on an uncaught
// error, leaving the page's CSS background (a plain <body> style, not
// rendered by React) as the only thing still visible - a completely blank-
// looking page with zero explanation. Most likely trigger in practice: one
// of the lazy-loaded route chunks (see App.jsx) fails to load - e.g. a
// browser tab left open from before a deploy, whose index.html still
// references a chunk hash that no longer exists on the server once new
// files replaced the old ones. lazyWithRetry in App.jsx already retries
// that specific case with a one-time reload; this is the fallback for
// anything that isn't fixed by a reload (or any other uncaught render bug).
//
// A class component because React error boundaries have no hook equivalent
// (getDerivedStateFromError/componentDidCatch aren't available as hooks).
// Deliberately doesn't use useLanguage()/the language context - if the crash
// happened above/inside that provider, depending on it here could just
// throw again. Reads the saved language directly instead, same localStorage
// key i18n.jsx itself uses, with a safe default if that's ever unavailable.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Uncaught render error:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    let lang = 'de';
    try {
      lang = localStorage.getItem('deathstep_language') || 'de';
    } catch (e) { /* localStorage unavailable */ }

    const text = lang === 'en'
      ? {
        title: 'Something went wrong',
        body: 'Please reload the page. If the problem persists, try again in a few minutes.',
        reload: 'Reload page',
      }
      : {
        title: 'Etwas ist schiefgelaufen',
        body: 'Bitte lade die Seite neu. Falls das Problem bestehen bleibt, versuch es in ein paar Minuten erneut.',
        reload: 'Seite neu laden',
      };

    return (
      <div className="app-container" style={{ padding: '20px' }}>
        <div className="cyber-card" style={{ maxWidth: '500px', margin: '80px auto 0', textAlign: 'center' }}>
          <h2 style={{ color: 'var(--neon-red)', marginBottom: '15px' }}>{text.title}</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>{text.body}</p>
          <button className="cyber-button" onClick={() => window.location.reload()}>{text.reload}</button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;

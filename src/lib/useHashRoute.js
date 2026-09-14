import { useCallback, useEffect, useState } from 'react';

// Hash routing rather than history routing: Firebase Hosting rewrites every
// path to index.html, so real paths would work, but hashes keep deep links
// working identically in dev, preview and production with no server config.

export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '').split('?')[0];
  const [view, sub] = raw.split('/').filter(Boolean);
  return { view: view || null, sub: sub || null };
}

export function buildHash(view, sub) {
  return `#/${[view, sub].filter(Boolean).join('/')}`;
}

/**
 * Reads the current route from location.hash and keeps it in sync with the
 * back/forward buttons. `navigate` writes the hash, which fires hashchange,
 * which is what actually updates state, so there is one path in and out.
 */
export function useHashRoute(defaultView) {
  const read = useCallback(() => {
    const p = parseHash(window.location.hash);
    return p.view ? p : { view: defaultView, sub: null };
  }, [defaultView]);

  const [route, setRoute] = useState(read);

  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, [read]);

  const navigate = useCallback((view, sub = null) => {
    const next = buildHash(view, sub);
    if (window.location.hash === next) {
      setRoute({ view, sub });
    } else {
      window.location.hash = next;
    }
  }, []);

  // Replace rather than push, so the landing route is not a history entry the
  // user has to press Back through to leave the app.
  const replace = useCallback((view, sub = null) => {
    const next = buildHash(view, sub);
    window.history.replaceState({}, '', window.location.pathname + window.location.search + next);
    setRoute({ view, sub });
  }, []);

  return { view: route.view, sub: route.sub, navigate, replace };
}

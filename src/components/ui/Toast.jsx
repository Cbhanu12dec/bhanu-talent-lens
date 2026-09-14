import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const ToastCtx = createContext(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

function Toast({ t, onDismiss }) {
  useEffect(() => {
    if (t.sticky) return;
    const id = setTimeout(() => onDismiss(t.id), t.duration || 4000);
    return () => clearTimeout(id);
  }, [t, onDismiss]);

  return (
    <div className={`toast toast--${t.kind || 'ok'}`}>
      <span className="toast-dot" aria-hidden="true" />
      <div className="toast-body">
        <div className="toast-title">{t.title}</div>
        {t.detail && <div className="toast-detail">{t.detail}</div>}
      </div>
      <button className="toast-x" onClick={() => onDismiss(t.id)} aria-label="Dismiss notification">✕</button>
    </div>
  );
}

/**
 * Non-blocking confirmations for saves and background work. Announced via an
 * aria-live region so the feedback is not purely visual.
 */
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);

  const dismiss = useCallback(id => setItems(list => list.filter(t => t.id !== id)), []);

  const push = useCallback(t => {
    const id = ++seq.current;
    setItems(list => [...list.slice(-3), { ...t, id }]);
    return id;
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {items.map(t => <Toast key={t.id} t={t} onDismiss={dismiss} />)}
      </div>
    </ToastCtx.Provider>
  );
}

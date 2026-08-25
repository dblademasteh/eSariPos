import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';

const ToastContext = createContext(null);
let counter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, type) => {
    const id = ++counter;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const toast = useMemo(
    () => ({
      success: (m) => push(m, 'success'),
      error: (m) => push(m, 'error'),
      info: (m) => push(m, 'info'),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast toast-end z-[999]" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : undefined}
            className={`alert alert-${t.type} shadow-lg py-2 text-sm`}
          >
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function Modal({ open, onClose, title, children, footer, wide }) {
  const boxRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => {
      const el = boxRef.current;
      if (!el) return;
      const focusable = el.querySelector('input:not([disabled]),select:not([disabled]),textarea:not([disabled])');
      (focusable ?? el).focus?.();
    }, 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="modal modal-open"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Dialog'}
        tabIndex={-1}
        className={`modal-box max-w-lg outline-none ${wide ? 'lg:max-w-3xl' : ''}`}
      >
        {title !== undefined && (
          <div className="mb-4 flex items-center justify-between gap-4">
            <h3 className="text-lg font-bold">{title}</h3>
            <button aria-label="Close dialog" className="btn btn-circle btn-ghost btn-sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {children}
        {footer && <div className="modal-action">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="block w-full">
      <span className="mb-1 block text-sm font-medium opacity-80">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs opacity-60">{hint}</span>}
    </label>
  );
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-base-content/60">
      <span className="loading loading-spinner loading-md text-primary"></span>
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ icon, title, subtitle }) {
  return (
    <div className="py-16 text-center">
      <div className="text-5xl">{typeof icon === 'string' ? icon : icon}</div>
      <p className="mt-3 font-semibold">{title}</p>
      {subtitle && <p className="mt-1 text-sm opacity-60">{subtitle}</p>}
    </div>
  );
}

export function RoleBadge({ role }) {
  const cls = { owner: 'badge-primary', manager: 'badge-secondary', cashier: 'badge-ghost' }[role] || 'badge-ghost';
  return <span className={`badge badge-sm capitalize ${cls}`}>{role}</span>;
}

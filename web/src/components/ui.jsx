import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { X, Check, Info, AlertTriangle } from 'lucide-react';

const ToastContext = createContext(null);
let counter = 0;

const TYPE_CONFIG = {
  success: {
    icon: Check,
    bg: 'bg-success/10 border-success/20',
    iconColor: 'text-success',
    barColor: 'bg-success',
  },
  error: {
    icon: X,
    bg: 'bg-error/10 border-error/20',
    iconColor: 'text-error',
    barColor: 'bg-error',
  },
  info: {
    icon: Info,
    bg: 'bg-info/10 border-info/20',
    iconColor: 'text-info',
    barColor: 'bg-info',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-warning/10 border-warning/20',
    iconColor: 'text-warning',
    barColor: 'bg-warning',
  },
};

function ToastItem({ id, message, type, onDismiss }) {
  const [progress, setProgress] = useState(100);
  const [exiting, setExiting] = useState(false);
  const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.info;
  const Icon = cfg.icon;
  const duration = type === 'error' ? 5000 : 3500;

  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      if (remaining > 0) requestAnimationFrame(tick);
    };
    const raf = requestAnimationFrame(tick);
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDismiss(id), 200);
    }, duration);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [id, duration, onDismiss]);

  function handleClose() {
    setExiting(true);
    setTimeout(() => onDismiss(id), 200);
  }

  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      className={`
        relative overflow-hidden rounded-xl border bg-base-100 shadow-xl
        transition-all duration-200 ease-out
        ${cfg.bg}
        ${exiting ? 'translate-x-[110%] opacity-0' : 'translate-x-0 opacity-100'}
      `}
      style={{ minWidth: '320px', maxWidth: '420px' }}
    >
      <div className="flex items-start gap-3 p-3">
        {/* Icon */}
        <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-base-200`}>
          <Icon className={`h-3.5 w-3.5 ${cfg.iconColor}`} strokeWidth={2.5} />
        </div>

        {/* Message */}
        <p className="flex-1 pt-0.5 text-sm font-medium leading-snug text-base-content">
          {message}
        </p>

        {/* Close */}
        <button
          onClick={handleClose}
          className="btn btn-ghost btn-xs btn-circle shrink-0 opacity-40 hover:opacity-100"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 w-full bg-base-300/30">
        <div
          className={`h-full rounded-full transition-none ${cfg.barColor}`}
          style={{ width: `${progress}%`, opacity: 0.6 }}
        />
      </div>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback((message, type) => {
    const id = ++counter;
    setToasts((t) => [...t.slice(-4), { id, message, type }]);
  }, []);

  const toast = useMemo(
    () => ({
      success: (m) => push(m, 'success'),
      error: (m) => push(m, 'error'),
      info: (m) => push(m, 'info'),
      warning: (m) => push(m, 'warning'),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-4 right-4 z-[999] flex flex-col-reverse gap-2" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} {...t} onDismiss={dismiss} />
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

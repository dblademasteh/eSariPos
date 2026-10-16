import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { X, Check, Info, AlertTriangle } from 'lucide-react';

const ToastContext = createContext(null);
let counter = 0;

const TYPE_CONFIG = {
  success: {
    icon: Check,
    label: 'success',
  },
  error: {
    icon: X,
    label: 'error',
  },
  info: {
    icon: Info,
    label: 'info',
  },
  warning: {
    icon: AlertTriangle,
    label: 'warning',
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
      className={`toast-item ${exiting ? 'opacity-0 pointer-events-none' : ''} ${type === 'error' ? 'toast-item.error' : type === 'success' ? 'toast-item.success' : 'toast-item.info'}`}
      aria-label={message}
    >
      <div className="toast-body">
        <div className="toast-icon toast-icon.${type === 'error' ? 'error' : type === 'success' ? 'success' : 'info'}">
          <Icon className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
        </div>
        <p className="toast-message">{message}</p>
        <button onClick={handleClose} className="toast-dismiss" aria-label="Dismiss">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="toast-progress">
        <div className="bar" style={{ width: `${progress}%` }} />
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
      <div className="toast-container" aria-live="polite">
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
      const focusable = el.querySelector('input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled])');
      (focusable ?? el).focus?.();
    }, 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose?.();
    }}>
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Dialog'}
        tabIndex={-1}
        className={`modal-box ${wide ? 'wide' : ''}`}
      >
        {title !== undefined && (
          <div className="modal-header">
            <h3 className="mb-4 text-lg font-bold tracking-tight text-ink">{title}</h3>
            <button aria-label="Close dialog" className="modal-close" onClick={onClose}>
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-action">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <div className="field">
      {label && <span className="field-label">{label}</span>}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-mute">
      <span className="spinner text-accent" aria-hidden="true"></span>
      <span className="text-mute">{label}</span>
    </div>
  );
}

export function EmptyState({ icon, title, subtitle }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">{typeof icon === 'string' ? icon : icon}</div>
      <p className="empty-title">{title}</p>
      {subtitle && <p className="empty-subtitle">{subtitle}</p>}
    </div>
  );
}

export function RoleBadge({ role }) {
  const cls = {
    owner: 'badge-pill fill-accent',
    manager: 'badge-pill accent',
    cashier: 'badge-pill',
  }[role] || 'badge-pill';
  return <span className={cls}>{role}</span>;
}

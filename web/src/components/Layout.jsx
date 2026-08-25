import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { makeMoney, fmtDateTime } from '../lib/format.js';
import { discardSale, flushQueue, retrySale, startAutoFlush } from '../lib/offlineQueue.js';
import { setLocationId } from '../lib/registerLocation.js';
import { useAuth } from '../state/AuthContext.jsx';
import { useOfflineQueue, useOnline } from '../state/useOfflineQueue.js';
import PinPad from './PinPad.jsx';
import { api } from '../api/client.js';
import { RoleBadge, useToast } from './ui.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '📊', perm: 'reports', end: true },
  { to: '/pos', label: 'Register', icon: '💵' },
  { to: '/products', label: 'Products', icon: '📦', perm: 'products' },
  { to: '/inventory', label: 'Inventory', icon: '🚚', perm: 'inventory' },
  { to: '/orders', label: 'Orders', icon: '🧾' },
  { to: '/customers', label: 'Customers', icon: '👥' },
  { to: '/gift-cards', label: 'Gift cards', icon: '🎟️', perm: 'giftcards' },
  { to: '/staff', label: 'Staff', icon: '🪪', minRank: 3 },
  { to: '/audit', label: 'Audit log', icon: '📜', minRank: 3 },
  { to: '/settings', label: 'Settings', icon: '⚙️', minRank: 2 },
];

function themeToggle() {
  const html = document.documentElement;
  const next = html.dataset.theme === 'novapos' ? 'novaposdark' : 'novapos';
  html.dataset.theme = next;
  localStorage.setItem('novapos.theme', next);
}

function SyncBadge() {
  const { tenant } = useAuth();
  const money = makeMoney(tenant?.currency);
  const online = useOnline();
  const queued = useOfflineQueue();
  const [syncing, setSyncing] = useState(false);

  if (online && queued.length === 0) return null;

  async function syncNow() {
    setSyncing(true);
    try {
      await flushQueue();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="dropdown dropdown-end">
      <button
        tabIndex={0}
        className={`btn btn-ghost btn-sm gap-2 ${!online ? 'text-warning' : ''}`}
        title="Queued offline sales"
      >
        <span className={`relative ${queued.some((q) => q.status === 'failed') ? 'text-error' : ''}`}>
          {online ? '⏳' : '📡'}
          {queued.length > 0 && (
            <span className="badge badge-error badge-xs absolute -right-2 -top-2 px-1">
              {queued.length}
            </span>
          )}
        </span>
        <span className="hidden sm:inline">{!online ? 'Offline' : `${queued.length} queued`}</span>
      </button>
      <ul className="menu dropdown-content z-50 mt-2 w-80 rounded-xl bg-base-100 p-2 shadow">
        <li className="menu-title flex-row items-center justify-between">
          <span>Offline sale queue</span>
          <span className="badge badge-ghost badge-sm">{queued.length}</span>
        </li>
        {!online && (
          <li className="px-2 py-1 text-xs opacity-60">
            You are offline. Sales taken now are saved here and replayed automatically when the
            connection returns.
          </li>
        )}
        {queued.length === 0 ? (
          <li className="px-2 py-1 text-xs opacity-60">Nothing queued.</li>
        ) : (
          queued.map((q) => (
            <li key={q.id} className="flex-row items-center gap-2 px-2 py-1">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  Sale · {money(q.total)}
                  <span
                    className={`badge badge-xs ${
                      q.status === 'failed' ? 'badge-error' : 'badge-warning'
                    }`}
                  >
                    {q.status}
                  </span>
                </div>
                <div className="truncate text-xs opacity-60">
                  {fmtDateTime(q.createdAt)}
                  {q.lastError ? ` · ${q.lastError}` : ''}
                </div>
              </div>
              {q.status === 'failed' && (
                <button
                  aria-label="Retry this sale"
                  className="btn btn-ghost btn-xs"
                  onClick={() => retrySale(q.id)}
                  title="Try this sale again"
                >
                  ↻
                </button>
              )}
              <button
                aria-label="Discard queued sale"
                className="btn btn-ghost btn-xs text-error"
                onClick={() => discardSale(q.id)}
                title="Discard queued sale"
              >
                ✕
              </button>
            </li>
          ))
        )}
        {queued.length > 0 && online && (
          <li className="mt-1">
            <button className={`btn btn-primary btn-sm btn-block ${syncing ? 'loading' : ''}`} onClick={syncNow}>
              Sync now
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

function LocationPicker() {
  const [locations, setLocations] = useState([]);
  const [value, setValue] = useState(() => localStorage.getItem('novapos.location') ?? '');

  useEffect(() => {
    api('/locations')
      .then(setLocations)
      .catch(() => {});
  }, []);

  return (
    locations.length === 0 ? null : (
      <select
        className="select select-sm hidden sm:inline-flex"
        title="Register location"
        value={value}
        onChange={(e) => {
          setLocationId(e.target.value);
          setValue(e.target.value);
        }}
      >
        <option value="">📍 Main stock</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            📍 {l.name}
          </option>
        ))}
      </select>
    )
  );
}

function fmtHours(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function TimeClock() {
  const toast = useToast();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setState(await api('/timeclock/me'));
    } catch {
      /* non-critical */
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  if (!state) return null;

  async function toggle() {
    setBusy(true);
    try {
      if (state.openShift) await api('/timeclock/clock-out', { method: 'POST', body: {} });
      else await api('/timeclock/clock-in', { method: 'POST', body: {} });
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className={`btn btn-ghost btn-sm gap-1 ${state.openShift ? 'text-success' : ''}`}
      title={state.openShift ? `Clocked in since ${fmtDateTime(state.openShift.clockIn)}` : 'Clock in'}
      onClick={toggle}
      disabled={busy}
    >
      ⏱ <span className="hidden md:inline">{state.openShift ? 'On shift' : 'Off'} ·</span>{' '}
      {fmtHours(state.todaySeconds)}
    </button>
  );
}

function SwitchUserModal({ open, onClose }) {
  const { login } = useAuth();
  const toast = useToast();
  const [targets, setTargets] = useState(null);
  const [target, setTarget] = useState(null);

  useEffect(() => {
    if (open) {
      api('/auth/switch-targets')
        .then((list) => {
          setTargets(list.filter((u) => u.hasPin));
          if (!list.some((u) => u.hasPin)) {
            toast.info('No colleagues have a PIN yet — set one from the user menu');
            onClose();
          }
        })
        .catch((err) => {
          toast.error(err.message);
          onClose();
        });
    } else {
      setTargets(null);
      setTarget(null);
    }
  }, [open]);

  if (!open) return null;

  async function submitPin(pin) {
    try {
      const data = await api('/auth/switch', {
        method: 'POST',
        body: { targetUserId: target.id, pin },
      });
      login(data);
      toast.success(`Now signed in as ${data.user.name}`);
      onClose();
    } catch (err) {
      err.message && toast.error(err.message);
      throw err;
    }
  }

  return (
    <div className="modal modal-open" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box max-w-sm">
        {!target ? (
          <>
            <h3 className="mb-3 text-lg font-bold">Who is taking over?</h3>
            <ul className="space-y-2">
              {(targets ?? []).map((u) => (
                <li key={u.id}>
                  <button className="btn btn-block justify-between" onClick={() => setTarget(u)}>
                    <span>{u.name}</span>
                    <RoleBadge role={u.role} />
                  </button>
                </li>
              ))}
              {targets !== null && targets.length === 0 && (
                <p className="py-4 text-center text-sm opacity-60">
                  No other staff have a PIN yet.
                </p>
              )}
            </ul>
            <div className="modal-action">
              <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : (
          <PinPad
            title={`PIN for ${target.name}`}
            confirmLabel="Switch"
            onDone={submitPin}
            onCancel={() => setTarget(null)}
          />
        )}
      </div>
    </div>
  );
}

const storedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem('novapos.theme') : null;
if (storedTheme) document.documentElement.dataset.theme = storedTheme;

export default function Layout() {
  const { user, tenant, logout, can, hasPerm } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [pinModal, setPinModal] = useState(null); // null | 'switch' | 'set'

  useEffect(() => {
    startAutoFlush();
  }, []);

  const items = NAV.filter((n) => (n.perm ? hasPerm(n.perm) : true) && (!n.minRank || can(n.minRank)));

  return (
    <div className="flex h-screen bg-base-200">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-base-300 bg-base-100 md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="text-2xl">🧾</span>
          <div>
            <div className="text-lg font-black leading-none tracking-tight">NovaPOS</div>
            <div className="mt-1 truncate text-xs opacity-60">{tenant?.name}</div>
          </div>
        </div>
        <nav className="flex-1 px-3">
          <ul className="menu w-full gap-1 p-0">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `rounded-lg ${isActive ? 'bg-primary/10 font-semibold text-primary' : ''}`
                  }
                >
                  <span>{item.icon}</span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-base-200 p-4 text-xs opacity-50">
          Business ID: <span className="font-mono">{tenant?.slug}</span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="navbar min-h-14 border-b border-base-300 bg-base-100 px-4">
          <div className="dropdown md:hidden">
            <button className="btn btn-ghost btn-sm" tabIndex={0}>
              ☰
            </button>
            <ul className="menu dropdown-content z-50 mt-2 w-52 rounded-xl bg-base-100 p-2 shadow">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end}>
                    <span>{item.icon}</span>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>

          <div className="mx-2 flex-1 truncate font-semibold">{tenant?.name}</div>

          <button
            className="btn btn-ghost btn-sm btn-circle"
            title="Open customer-facing display"
            onClick={() => window.open('/display', 'novapos-display', 'width=800,height=600')}
          >
            🖥️
          </button>
          <LocationPicker />
          <TimeClock />
          <SyncBadge />

          <button
            className="btn btn-ghost btn-sm btn-circle"
            onClick={themeToggle}
            aria-label="Toggle color theme"
            title="Toggle theme"
          >
            🌓
          </button>

          <div className="dropdown dropdown-end">
            <button aria-label="Account menu" className="btn btn-ghost btn-sm gap-2" tabIndex={0}>
              <div className="placeholder avatar">
                <div className="w-7 rounded-full bg-secondary text-secondary-content">
                  <span className="text-xs uppercase">{user?.name?.[0]}</span>
                </div>
              </div>
              <span className="hidden sm:inline">{user?.name}</span>
            </button>
            <ul className="menu dropdown-content z-50 mt-2 w-56 rounded-xl bg-base-100 p-2 shadow">
              <li className="menu-title flex-row items-center justify-between gap-2">
                <span className="truncate">{user?.email}</span>
                <RoleBadge role={user?.role} />
              </li>
              <li>
                <button
                  onClick={() => {
                    setPinModal('switch');
                    document.activeElement?.blur();
                  }}
                >
                  🔁 Switch user (PIN)
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    setPinModal('set');
                    document.activeElement?.blur();
                  }}
                >
                  #️⃣ Set my register PIN
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    navigate('/pos?drawer=1');
                    document.activeElement?.blur();
                  }}
                >
                  💵 Cash drawer
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    logout();
                    navigate('/login');
                  }}
                >
                  🚪 Sign out
                </button>
              </li>
            </ul>
            {pinModal === 'switch' && (
              <SwitchUserModal open onClose={() => setPinModal(null)} />
            )}
            {pinModal === 'set' && (
              <div
                className="modal modal-open"
                onMouseDown={(e) => e.target === e.currentTarget && setPinModal(null)}
              >
                <div className="modal-box max-w-sm">
                  <PinPad
                    title="Set your 4-8 digit PIN"
                    confirmLabel="Save"
                    onDone={async (pin) => {
                      try {
                        await api('/auth/my-pin', { method: 'PUT', body: { pin } });
                        toast.success('PIN saved');
                        setPinModal(null);
                      } catch (err) {
                        err.message && toast.error(err.message);
                        throw err;
                      }
                    }}
                    onCancel={() => setPinModal(null)}
                  />
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

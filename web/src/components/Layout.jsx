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
import {
  BarChart3, Banknote, Package, Truck, Receipt, Users, Ticket, IdCard,
  ScrollText, Settings, Clock, Menu, Monitor, Moon, ArrowRightLeft, Hash,
  LogOut, MapPin, RotateCw, X, WifiOff, Loader, CloudOff, Check,
  ChevronLeft, ChevronRight,
} from 'lucide-react';

const NAV_SECTIONS = [
  {
    label: 'Sales',
    items: [
      { to: '/', label: 'Dashboard', icon: BarChart3, perm: 'reports', end: true },
      { to: '/pos', label: 'Register', icon: Banknote },
      { to: '/products', label: 'Products', icon: Package, perm: 'products' },
      { to: '/inventory', label: 'Inventory', icon: Truck, perm: 'inventory' },
      { to: '/orders', label: 'Orders', icon: Receipt },
      { to: '/customers', label: 'Customers', icon: Users },
      { to: '/gift-cards', label: 'Gift cards', icon: Ticket, perm: 'giftcards' },
    ],
  },
  {
    label: 'Management',
    items: [
      { to: '/staff', label: 'Staff', icon: IdCard, minRank: 3 },
      { to: '/audit', label: 'Audit log', icon: ScrollText, minRank: 3 },
      { to: '/settings', label: 'Settings', icon: Settings, minRank: 2 },
    ],
  },
];

function themeToggle() {
  const html = document.documentElement;
  const next = html.dataset.theme === 'novapos' ? 'novaposdark' : 'novapos';
  html.dataset.theme = next;
  localStorage.setItem('novapos.theme', next);
}

function SyncBadge({ collapsed }) {
  const { tenant } = useAuth();
  const money = makeMoney(tenant?.currency);
  const online = useOnline();
  const queued = useOfflineQueue();
  const [syncing, setSyncing] = useState(false);

  if (online && queued.length === 0) return null;

  async function syncNow() {
    setSyncing(true);
    try { await flushQueue(); } finally { setSyncing(false); }
  }

  return (
    <div className="dropdown dropdown-end">
      <button
        tabIndex={0}
        className={`btn btn-ghost btn-sm gap-2 ${!online ? 'text-warning' : ''}`}
        title="Queued offline sales"
      >
        <span className={`relative ${queued.some((q) => q.status === 'failed') ? 'text-error' : ''}`}>
          {online ? <Loader className="h-4 w-4 animate-spin" /> : <WifiOff className="h-4 w-4" />}
          {queued.length > 0 && (
            <span className="badge badge-error badge-xs absolute -right-2 -top-2 px-1">
              {queued.length}
            </span>
          )}
        </span>
        {!collapsed && <span className="hidden sm:inline">{!online ? 'Offline' : `${queued.length} queued`}</span>}
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
                  <span className={`badge badge-xs ${q.status === 'failed' ? 'badge-error' : 'badge-warning'}`}>
                    {q.status}
                  </span>
                </div>
                <div className="truncate text-xs opacity-60">
                  {fmtDateTime(q.createdAt)}
                  {q.lastError ? ` · ${q.lastError}` : ''}
                </div>
              </div>
              {q.status === 'failed' && (
                <button aria-label="Retry this sale" className="btn btn-ghost btn-xs" onClick={() => retrySale(q.id)} title="Try this sale again">
                  <RotateCw className="h-3 w-3" />
                </button>
              )}
              <button aria-label="Discard queued sale" className="btn btn-ghost btn-xs text-error" onClick={() => discardSale(q.id)} title="Discard queued sale">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))
        )}
        {queued.length > 0 && online && (
          <li className="mt-1">
            <button className={`btn btn-primary btn-sm btn-block ${syncing ? 'loading' : ''}`} onClick={syncNow}>Sync now</button>
          </li>
        )}
      </ul>
    </div>
  );
}

function LocationPicker({ collapsed }) {
  const [locations, setLocations] = useState([]);
  const [value, setValue] = useState(() => localStorage.getItem('novapos.location') ?? '');

  useEffect(() => {
    api('/locations').then(setLocations).catch(() => {});
  }, []);

  if (locations.length === 0) return null;

  if (collapsed) {
    return (
      <div className="tooltip tooltip-right" data-tip="Register location">
        <MapPin className="h-4 w-4 opacity-60" />
      </div>
    );
  }

  return (
    <select
      className="select select-sm hidden sm:inline-flex"
      title="Register location"
      value={value}
      onChange={(e) => { setLocationId(e.target.value); setValue(e.target.value); }}
    >
      <option value="">Main stock</option>
      {locations.map((l) => (
        <option key={l.id} value={l.id}>{l.name}</option>
      ))}
    </select>
  );
}

function fmtHours(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function TimeClock({ collapsed }) {
  const toast = useToast();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setState(await api('/timeclock/me')); } catch { /* non-critical */ }
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
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }

  if (collapsed) {
    return (
      <button
        className={`btn btn-ghost btn-sm btn-circle ${state.openShift ? 'text-success' : ''}`}
        title={state.openShift ? `Clocked in · ${fmtHours(state.todaySeconds)}` : `Off shift · ${fmtHours(state.todaySeconds)}`}
        onClick={toggle}
        disabled={busy}
      >
        <Clock className="h-4 w-4" />
      </button>
    );
  }

  return (
    <button
      className={`btn btn-ghost btn-sm gap-1 ${state.openShift ? 'text-success' : ''}`}
      title={state.openShift ? `Clocked in since ${fmtDateTime(state.openShift.clockIn)}` : 'Clock in'}
      onClick={toggle}
      disabled={busy}
    >
      <Clock className="h-4 w-4" /> <span className="hidden md:inline">{state.openShift ? 'On shift' : 'Off'} ·</span>{' '}
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
        .catch((err) => { toast.error(err.message); onClose(); });
    } else {
      setTargets(null);
      setTarget(null);
    }
  }, [open]);

  if (!open) return null;

  async function submitPin(pin) {
    try {
      const data = await api('/auth/switch', { method: 'POST', body: { targetUserId: target.id, pin } });
      login(data);
      toast.success(`Now signed in as ${data.user.name}`);
      onClose();
    } catch (err) { err.message && toast.error(err.message); throw err; }
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
                <p className="py-4 text-center text-sm opacity-60">No other staff have a PIN yet.</p>
              )}
            </ul>
            <div className="modal-action">
              <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : (
          <PinPad title={`PIN for ${target.name}`} confirmLabel="Switch" onDone={submitPin} onCancel={() => setTarget(null)} />
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
  const [pinModal, setPinModal] = useState(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('esaripos.sidebar') === 'collapsed');

  useEffect(() => { startAutoFlush(); }, []);

  function toggleCollapse() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem('esaripos.sidebar', next ? 'collapsed' : 'expanded');
      return next;
    });
  }

  return (
    <div className="flex h-screen bg-base-200">
      {/* ── Desktop Sidebar ── */}
      <aside
        className={`hidden flex-col border-r border-base-300 bg-base-100 transition-all duration-200 md:flex ${
          collapsed ? 'w-[60px]' : 'w-56'
        }`}
      >
        {/* Logo */}
        <div className={`flex items-center gap-2 border-b border-base-300 px-3 py-3 ${collapsed ? 'justify-center' : 'px-3'}`}>
          <button
            onClick={toggleCollapse}
            className="btn btn-ghost btn-xs btn-circle shrink-0"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Menu className="h-4 w-4" />
          </button>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-bold leading-tight tracking-tight truncate">eSariPOS</div>
              <div className="truncate text-[10px] opacity-50 leading-tight">{tenant?.name}</div>
            </div>
          )}
        </div>

        {/* Nav sections */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV_SECTIONS.map((section) => {
            const visibleItems = section.items.filter(
              (n) => (n.perm ? hasPerm(n.perm) : true) && (!n.minRank || can(n.minRank))
            );
            if (visibleItems.length === 0) return null;

            return (
              <div key={section.label} className="mb-3">
                {!collapsed && (
                  <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest opacity-40">
                    {section.label}
                  </div>
                )}
                {collapsed && <div className="my-2 mx-auto h-px w-4 bg-base-300" />}
                <ul className="flex flex-col gap-0.5">
                  {visibleItems.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) =>
                          `group flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                            collapsed ? 'justify-center' : ''
                          } ${
                            isActive
                              ? 'bg-primary/10 font-semibold text-primary'
                              : 'text-base-content/70 hover:bg-base-300/50 hover:text-base-content'
                          }`
                        }
                        title={collapsed ? item.label : undefined}
                      >
                        <item.icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>

      {/* ── Main column ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-base-300 bg-base-100 px-3 shadow-sm sm:px-4">
          {/* ── Left: mobile menu + tenant ── */}
          <div className="dropdown md:hidden">
            <button className="btn btn-ghost btn-sm btn-circle" tabIndex={0} aria-label="Navigation menu">
              <Menu className="h-5 w-5" />
            </button>
            <ul className="menu dropdown-content z-50 mt-2 w-56 rounded-xl bg-base-100 p-2 shadow-lg">
              {NAV_SECTIONS.flatMap((section, si) => {
                const visibleItems = section.items.filter(
                  (n) => (n.perm ? hasPerm(n.perm) : true) && (!n.minRank || can(n.minRank))
                );
                if (visibleItems.length === 0) return [];
                const separator = si > 0 ? [{ type: 'sep', key: `sep-${si}` }] : [];
                const items = visibleItems.map((item) => ({ type: 'item', key: item.to, ...item }));
                return [...separator, ...items];
              }).map((entry) =>
                entry.type === 'sep' ? (
                  <li key={entry.key} className="menu-title pt-2 text-[10px] uppercase tracking-widest opacity-40">
                    <span className="px-0">&nbsp;</span>
                  </li>
                ) : (
                  <li key={entry.key}>
                    <NavLink to={entry.to} end={entry.end}>
                      <entry.icon className="h-4 w-4" />
                      {entry.label}
                    </NavLink>
                  </li>
                )
              )}
            </ul>
          </div>

          <div className="truncate text-sm font-semibold text-base-content sm:text-[15px]">{tenant?.name}</div>

          {/* ── Right: action controls ── */}
          <div className="ml-auto flex items-center gap-1">
            {/* Primary actions */}
            <button
              className="btn btn-ghost btn-sm btn-circle"
              title="Open customer-facing display"
              onClick={() => window.open('/display', 'novapos-display', 'width=800,height=600')}
            >
              <Monitor className="h-4 w-4" />
            </button>

            <div className="hidden sm:block">
              <LocationPicker collapsed={false} />
            </div>

            <div className="hidden sm:block">
              <TimeClock collapsed={false} />
            </div>

            <SyncBadge collapsed={false} />

            {/* Separator */}
            <div className="mx-1 hidden h-5 w-px bg-base-300 sm:block" />

            {/* Secondary actions */}
            <button className="btn btn-ghost btn-sm btn-circle" onClick={themeToggle} aria-label="Toggle color theme" title="Toggle theme">
              <Moon className="h-4 w-4" />
            </button>

            {/* User menu */}
            <div className="dropdown dropdown-end">
              <button aria-label="Account menu" className="btn btn-ghost btn-sm gap-2 px-2" tabIndex={0}>
                <div className="placeholder avatar">
                  <div className="w-8 rounded-full bg-primary/15 text-primary ring-1 ring-primary/20">
                    <span className="text-xs font-semibold uppercase leading-8">{user?.name?.[0]}</span>
                  </div>
                </div>
                <span className="hidden text-[13px] font-medium sm:inline">{user?.name}</span>
              </button>
              <ul className="menu dropdown-content z-50 mt-2 w-56 rounded-xl bg-base-100 p-2 shadow-lg">
                <li className="menu-title flex-row items-center justify-between gap-2">
                  <span className="truncate">{user?.email}</span>
                  <RoleBadge role={user?.role} />
                </li>
                <li>
                  <button onClick={() => { setPinModal('switch'); document.activeElement?.blur(); }}>
                    <ArrowRightLeft className="mr-2 inline h-4 w-4" /> Switch user (PIN)
                  </button>
                </li>
                <li>
                  <button onClick={() => { setPinModal('set'); document.activeElement?.blur(); }}>
                    <Hash className="mr-2 inline h-4 w-4" /> Set my register PIN
                  </button>
                </li>
                <li>
                  <button onClick={() => { navigate('/pos?drawer=1'); document.activeElement?.blur(); }}>
                    <Banknote className="mr-2 inline h-4 w-4" /> Cash drawer
                  </button>
                </li>
                <div className="my-1 h-px bg-base-300" />
                <li>
                  <button onClick={() => { logout(); navigate('/login'); }} className="text-error">
                    <LogOut className="mr-2 inline h-4 w-4" /> Sign out
                  </button>
                </li>
              </ul>
              {pinModal === 'switch' && <SwitchUserModal open onClose={() => setPinModal(null)} />}
              {pinModal === 'set' && (
                <div className="modal modal-open" onMouseDown={(e) => e.target === e.currentTarget && setPinModal(null)}>
                  <div className="modal-box max-w-sm">
                    <PinPad
                      title="Set your 4-8 digit PIN"
                      confirmLabel="Save"
                      onDone={async (pin) => {
                        try {
                          await api('/auth/my-pin', { method: 'PUT', body: { pin } });
                          toast.success('PIN saved');
                          setPinModal(null);
                        } catch (err) { err.message && toast.error(err.message); throw err; }
                      }}
                      onCancel={() => setPinModal(null)}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

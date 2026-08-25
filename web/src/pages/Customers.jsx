import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { fmtDateTime, makeMoney } from '../lib/format.js';
import { downloadCsv } from '../lib/export.js';
import { useAuth } from '../state/AuthContext.jsx';
import { EmptyState, Field, Modal, Spinner, useToast } from '../components/ui.jsx';

const STATUS_BADGES = {
  completed: 'badge-success',
  partially_refunded: 'badge-warning',
  refunded: 'badge-error',
  layaway: 'badge-warning',
  cancelled: 'badge-ghost',
};

export default function Customers() {
  const { tenant, hasPerm, can } = useAuth();
  const toast = useToast();
  const money = makeMoney(tenant?.currency);
  const canReport = hasPerm('reports');

  const [customers, setCustomers] = useState(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [profile, setProfile] = useState(null);

  async function load() {
    try {
      setCustomers(await api('/customers', { query: { search } }));
    } catch (err) {
      toast.error(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-xl font-bold">Customers</h1>
          <p className="text-sm opacity-60">Loyalty points, store credit and purchase history</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input className="input input-sm w-44" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {canReport && (
            <button
              className="btn btn-outline btn-sm"
              onClick={async () => {
                try {
                  const rows = await api('/customers/export', { query: { days: 365 } });
                  downloadCsv('marketing-segments', [
                    { key: 'name' }, { key: 'email' }, { key: 'phone' },
                    { key: 'visits', label: 'Visits (all time)' },
                    { key: 'lifetimeValue', label: 'Lifetime value' },
                    { key: 'recentSpend', label: 'Spend last 365d' },
                  ], rows);
                } catch (err) {
                  toast.error(err.message);
                }
              }}
            >
              ⬇ Marketing CSV
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>+ Add customer</button>
        </div>
      </div>

      {!customers ? (
        <Spinner />
      ) : customers.length === 0 ? (
        <EmptyState icon="👥" title="No customers yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-base-100 shadow">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th><th>Contact</th>
                <th className="text-right">Points</th>
                <th className="text-right">Store credit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-base-200" onClick={() => setProfile(c.id)}>
                  <td className="font-medium">{c.name}</td>
                  <td className="text-xs opacity-70">{c.phone || c.email || '—'}</td>
                  <td className="text-right font-mono">{c.loyaltyPoints}</td>
                  <td className="text-right font-semibold">{money(c.storeCredit)}</td>
                  <td className="text-right">
                    <button
                      aria-label={`Edit ${c.name}`}
                      className="btn btn-ghost btn-xs"
                      onClick={(e) => { e.stopPropagation(); setEditing(c); }}
                    >
                      ✏️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canReport && <CouponsCard />}

      <CustomerModal open={!!editing} customer={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      <ProfileModal id={profile} money={money} canTopup={hasPerm('giftcards')} onClose={() => setProfile(null)} onChanged={() => load()} />
    </div>
  );
}

function CustomerModal({ open, customer, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !customer?.id;
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({
        name: customer?.name ?? '',
        phone: customer?.phone ?? '',
        email: customer?.email ?? '',
        note: customer?.note ?? '',
      });
    }
  }, [open, customer]);

  if (!open || !form) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    try {
      if (isNew) await api('/customers', { method: 'POST', body: form });
      else await api(`/customers/${customer.id}`, { method: 'PATCH', body: form });
      onSaved();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'Add customer' : `Edit ${customer.name}`}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Name"><input className="input input-md w-full" value={form.name} onChange={set('name')} required autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><input className="input input-md w-full" value={form.phone} onChange={set('phone')} /></Field>
          <Field label="Email" hint="Used for e-receipts"><input type="email" className="input input-md w-full" value={form.email} onChange={set('email')} /></Field>
        </div>
        <Field label="Note"><input className="input input-md w-full" value={form.note} onChange={set('note')} /></Field>
        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}

function ProfileModal({ id, money, canTopup, onClose, onChanged }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [topup, setTopup] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api(`/customers/${id}`));
    } catch (err) {
      toast.error(err.message);
    }
  }

  useEffect(() => {
    if (id) load();
  }, [id]);

  if (!id) return null;

  async function addCredit() {
    setBusy(true);
    try {
      await api(`/customers/${id}/topup`, { method: 'POST', body: { amount: Number(topup) } });
      toast.success('Store credit added');
      setTopup('');
      await load();
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!id} onClose={onClose} title={data ? data.name : ''} wide>
      {!data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Loyalty points" value={data.loyaltyPoints} />
            <Stat label="Store credit" value={money(data.storeCredit)} />
            <Stat label="Visits" value={data.stats.visits} />
            <Stat label="Lifetime value" value={money(data.stats.lifetimeValue)} />
          </div>

          {canTopup && (
            <div className="flex items-end gap-2 rounded-xl border border-base-300 p-3">
              <label className="flex-1">
                <span className="mb-1 block text-sm opacity-70">Add store credit</span>
                <input type="number" min="0.01" step="0.01" className="input input-sm w-full" placeholder="0.00" value={topup} onChange={(e) => setTopup(e.target.value)} />
              </label>
              <button className={`btn btn-primary btn-sm ${busy ? 'loading' : ''}`} disabled={!(Number(topup) > 0) || busy} onClick={addCredit}>
                Top up
              </button>
            </div>
          )}

          <div>
            <h4 className="mb-2 text-sm font-bold opacity-70">Recent orders</h4>
            {data.orders.length === 0 ? (
              <p className="text-sm opacity-60">No orders yet.</p>
            ) : (
              <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {data.orders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between rounded-lg bg-base-200 px-3 py-1.5 text-sm">
                    <span className="font-mono">#{o.orderNo}</span>
                    <span className={`badge badge-xs ${STATUS_BADGES[o.status] ?? 'badge-ghost'}`}>{o.status.replace('_', ' ')}</span>
                    <span className="font-semibold">{money(o.total)}</span>
                    <span className="text-xs opacity-60">{fmtDateTime(o.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-base-200 p-3">
      <div className="text-xs uppercase tracking-wide opacity-60">{label}</div>
      <div className="text-lg font-black">{value}</div>
    </div>
  );
}

/* ---------------- Coupons (marketing) ---------------- */

function CouponsCard() {
  const { tenant } = useAuth();
  const money = makeMoney(tenant?.currency);
  const toast = useToast();
  const [coupons, setCoupons] = useState(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      setCoupons(await api('/coupons'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="card bg-base-100 p-4 shadow">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-bold">Coupon codes</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ New coupon</button>
      </div>
      {!coupons ? (
        <Spinner />
      ) : coupons.length === 0 ? (
        <p className="py-4 text-center text-sm opacity-60">No coupons yet — % off codes apply automatically at checkout.</p>
      ) : (
        <table className="table table-sm">
          <thead>
            <tr><th>Code</th><th className="text-right">Discount</th><th>Window</th><th className="text-right">Used</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {coupons.map((c) => (
              <tr key={c.id} className={!c.isActive ? 'opacity-50' : ''}>
                <td className="font-mono font-medium">{c.code}</td>
                <td className="text-right font-semibold">{c.percentOff}%</td>
                <td className="text-xs opacity-60">
                  {c.startsAt ? `${new Date(c.startsAt).toLocaleDateString()} → ` : ''}
                  {c.endsAt ? new Date(c.endsAt).toLocaleDateString() : 'no end'}
                </td>
                <td className="text-right font-mono">{c.timesUsed}{c.maxUses ? ` / ${c.maxUses}` : ''}</td>
                <td>{c.isActive ? <span className="badge badge-success badge-xs">active</span> : <span className="badge badge-ghost badge-xs">off</span>}</td>
                <td className="text-right">
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={async () => {
                      try {
                        await api(`/coupons/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } });
                        load();
                      } catch (err) { toast.error(err.message); }
                    }}
                  >
                    {c.isActive ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <CouponCreateModal open={creating} onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />
    </div>
  );
}

function CouponCreateModal({ open, onClose, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({ code: '', percentOff: '', endsAt: '', maxUses: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm({ code: '', percentOff: '', endsAt: '', maxUses: '' });
  }, [open]);

  async function create() {
    setBusy(true);
    try {
      await api('/coupons', {
        method: 'POST',
        body: {
          code: form.code.trim(),
          percentOff: Number(form.percentOff),
          endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
          maxUses: form.maxUses ? Number(form.maxUses) : null,
        },
      });
      toast.success(`Coupon ${form.code.toUpperCase()} created`);
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New coupon">
      <div className="space-y-3">
        <Field label="Code">
          <input className="input input-md w-full font-mono uppercase" placeholder="WELCOME10" value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="% off">
            <input type="number" min="0.01" max="100" step="0.01" className="input input-md w-full" value={form.percentOff}
              onChange={(e) => setForm((f) => ({ ...f, percentOff: e.target.value }))} />
          </Field>
          <Field label="Max uses" hint="Blank = unlimited">
            <input type="number" min="1" className="input input-md w-full" value={form.maxUses}
              onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))} />
          </Field>
        </div>
        <Field label="Ends at" hint="Optional expiry">
          <input type="date" className="input input-md w-full" value={form.endsAt}
            onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} />
        </Field>
        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className={`btn btn-primary ${busy ? 'loading' : ''}`} disabled={busy || !form.code || !(Number(form.percentOff) > 0)} onClick={create}>
            Create coupon
          </button>
        </div>
      </div>
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { fmtDateTime, makeMoney } from '../lib/format.js';
import { downloadCsv } from '../lib/export.js';
import { useAuth } from '../state/AuthContext.jsx';
import { EmptyState, Field, Modal, Spinner, useToast } from '../components/ui.jsx';
import { Users, Pencil, Download } from 'lucide-react';

const STATUS_BADGES = {
  completed: { cls: 'bg-accent/10 text-accent border border-accent/20', label: 'Completed' },
  partially_refunded: { cls: 'bg-warn/10 text-warn border border-warn/20', label: 'Partly refunded' },
  refunded: { cls: 'bg-warn text-white', label: 'Refunded' },
  layaway: { cls: 'bg-warn/10 text-warn border border-warn/20', label: 'Layaway' },
  cancelled: { cls: 'border border-line text-mute', label: 'Cancelled' },
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
      <div className="receipt-head">
        <div className="receipt-meta">
          <span className="font-bold">{tenant?.name}</span>
          <span className="dot" aria-hidden="true"></span>
          <span>{new Date().toLocaleDateString()}</span>
        </div>
        <h1 className="text-xl font-bold">Customers</h1>
        <p className="text-sm text-mute">Loyalty points, store credit and purchase history</p>
        <div className="ml-auto flex items-center gap-2 mt-2">
          <input className="input-field input-sm w-44 text-ink" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {canReport && (
            <button
              className="btn-outline btn-sm"
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
              <Download className="mr-1 inline h-4 w-4" /> Marketing CSV
            </button>
          )}
          <button className="btn-cta btn-sm" onClick={() => setEditing({})}>+ Add customer</button>
        </div>
      </div>

      {!customers ? (
        <Spinner />
      ) : customers.length === 0 ? (
        <EmptyState icon={<Users className="mx-auto h-12 w-12 text-mute" />} title="No customers yet" subtitle="Add your first customer to start earning loyalty points." />
      ) : (
        <div className="overflow-x-auto card-counter">
          <table className="table-counter">
            <thead>
              <tr>
                <th className="text-ink">Name</th><th className="text-ink">Contact</th>
                <th className="text-right text-ink">Points</th>
                <th className="text-right text-ink">Store credit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-panel" onClick={() => setProfile(c.id)}>
                  <td className="font-medium text-ink">{c.name}</td>
                  <td className="text-xs text-mute">{c.phone || c.email || '—'}</td>
                  <td className="text-right font-data text-ink">{c.loyaltyPoints}</td>
                  <td className="text-right font-semibold text-ink">{money(c.storeCredit)}</td>
                  <td className="text-right">
                    <button
                      aria-label={`Edit ${c.name}`}
                      className="btn-ghost btn-xs text-mute hover:bg-panel hover:text-ink"
                      onClick={(e) => { e.stopPropagation(); setEditing(c); }}
                    >
                      <Pencil className="h-4 w-4" />
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
        marketingOptin: customer?.marketingOptin ?? false,
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
        <Field label="Name"><input className="input input-md w-full text-ink" value={form.name} onChange={set('name')} required autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><input className="input input-md w-full text-ink" value={form.phone} onChange={set('phone')} /></Field>
          <Field label="Email" hint="Used for e-receipts"><input type="email" className="input input-md w-full text-ink" value={form.email} onChange={set('email')} /></Field>
        </div>
        <Field label="Note"><input className="input input-md w-full text-ink" value={form.note} onChange={set('note')} /></Field>
        <label className="flex items-center gap-3 rounded-lg bg-panel p-3 text-ink">
          <input type="checkbox" className="checkbox-field checkbox-sm" checked={form.marketingOptin} onChange={(e) => setForm((f) => ({ ...f, marketingOptin: e.target.checked }))} />
          <div>
            <div className="text-sm font-medium">Email marketing opt-in</div>
            <div className="text-xs text-mute">Customer consents to receiving promotional emails</div>
          </div>
        </label>
        <div className="modal-action">
          <button type="button" className="btn-ghost text-mute hover:bg-panel hover:text-ink" onClick={onClose}>Cancel</button>
          <button className="btn-cta">Save</button>
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
          <div className="flex items-center gap-2 text-sm">
            <span className={`badge-pill badge-sm rounded-full ${data.marketingOptin ? 'bg-accent/10 text-accent border border-accent/20' : 'border border-line text-mute'}`}>
              {data.marketingOptin ? 'Email opted in' : 'Not opted in'}
            </span>
          </div>

          {canTopup && (
            <div className="flex items-end gap-2 rounded-lg border border-line p-3">
              <label className="flex-1">
                <span className="mb-1 block text-sm text-mute">Add store credit</span>
                <input type="number" min="0.01" step="0.01" className="input-field input-sm w-full text-ink" placeholder="0.00" value={topup} onChange={(e) => setTopup(e.target.value)} />
              </label>
              <button className={`btn-cta btn-sm ${busy ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={!(Number(topup) > 0) || busy} onClick={addCredit}>
                Top up
              </button>
            </div>
          )}

          <div>
            <h4 className="mb-2 text-sm font-bold text-mute">Recent orders</h4>
            {data.orders.length === 0 ? (
              <p className="text-sm text-mute">No orders yet.</p>
            ) : (
              <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {data.orders.map((o) => {
                  const s = STATUS_BADGES[o.status] ?? { cls: 'border border-line text-mute', label: o.status };
                  return (
                    <li key={o.id} className="flex items-center justify-between rounded-lg bg-panel px-3 py-1.5 text-sm">
                      <span className="font-data text-ink">#{o.orderNo}</span>
                      <span className={`badge-pill badge-sm rounded-full ${s.cls}`}>{s.label}</span>
                      <span className="font-semibold text-ink">{money(o.total)}</span>
                      <span className="text-xs text-mute">{fmtDateTime(o.createdAt)}</span>
                    </li>
                  );
                })}
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
    <div className="rounded-lg bg-panel p-3">
      <div className="text-xs uppercase tracking-wide text-mute">{label}</div>
      <div className="text-lg font-black text-ink">{value}</div>
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
    <div className="card-counter p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-bold text-ink">Coupon codes</h2>
        <button className="btn-cta btn-sm" onClick={() => setCreating(true)}>+ New coupon</button>
      </div>
      {!coupons ? (
        <Spinner />
      ) : coupons.length === 0 ? (
        <p className="py-4 text-center text-sm text-mute">No coupons yet — % off codes apply automatically at checkout.</p>
      ) : (
        <table className="table-counter table-sm">
          <thead>
            <tr><th className="text-ink">Code</th><th className="text-right text-ink">Discount</th><th className="text-ink">Window</th><th className="text-right text-ink">Used</th><th className="text-ink">Status</th><th></th></tr>
          </thead>
          <tbody>
            {coupons.map((c) => (
              <tr key={c.id} className={!c.isActive ? 'text-mute' : ''}>
                <td className="font-data font-medium text-ink">{c.code}</td>
                <td className="text-right font-semibold text-ink">{c.percentOff}%</td>
                <td className="text-xs text-mute">
                  {c.startsAt ? `${new Date(c.startsAt).toLocaleDateString()} -> ` : ''}
                  {c.endsAt ? new Date(c.endsAt).toLocaleDateString() : 'no end'}
                </td>
                <td className="text-right font-data text-ink">{c.timesUsed}{c.maxUses ? ` / ${c.maxUses}` : ''}</td>
                <td>{c.isActive ? <span className="badge-pill badge-sm accent">active</span> : <span className="badge-pill badge-sm">off</span>}</td>
                <td className="text-right">
                  <button
                    className="btn-ghost btn-xs text-mute hover:bg-panel hover:text-ink"
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
          <input className="input input-md w-full font-data text-ink uppercase" placeholder="WELCOME10" value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="% off">
            <input type="number" min="0.01" max="100" step="0.01" className="input input-md w-full text-ink" value={form.percentOff}
              onChange={(e) => setForm((f) => ({ ...f, percentOff: e.target.value }))} />
          </Field>
          <Field label="Max uses" hint="Blank = unlimited">
            <input type="number" min="1" className="input input-md w-full text-ink" value={form.maxUses}
              onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))} />
          </Field>
        </div>
        <Field label="Ends at" hint="Optional expiry">
          <input type="date" className="input input-md w-full text-ink" value={form.endsAt}
            onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} />
        </Field>
        <div className="modal-action">
          <button className="btn-ghost text-mute hover:bg-panel hover:text-ink" onClick={onClose}>Cancel</button>
          <button className={`btn-cta ${busy ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={busy || !form.code || !(Number(form.percentOff) > 0)} onClick={create}>
            Create coupon
          </button>
        </div>
      </div>
    </Modal>
  );
}

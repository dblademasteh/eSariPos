import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { fmtDateTime, makeMoney } from '../lib/format.js';
import { useAuth } from '../state/AuthContext.jsx';
import { EmptyState, Field, Modal, Spinner, useToast } from '../components/ui.jsx';

const TABS = ['Purchase orders', 'Suppliers', 'Stock counts', 'Transfers'];
const PO_STATUS = { draft: 'badge-ghost', sent: 'badge-info', partial: 'badge-warning', received: 'badge-success', cancelled: 'badge-error' };

export default function Inventory() {
  const [tab, setTab] = useState('Purchase orders');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Inventory & suppliers</h1>
        <p className="text-sm opacity-60">Purchase orders, suppliers, cycle counts and stock transfers</p>
      </div>
      <div role="tablist" className="tabs-boxed tabs w-fit">
        {TABS.map((t) => (
          <button key={t} role="tab" className={`tab ${tab === t ? 'tab-active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Purchase orders' && <PurchaseOrdersTab />}
      {tab === 'Suppliers' && <SuppliersTab />}
      {tab === 'Stock counts' && <CountsTab />}
      {tab === 'Transfers' && <TransfersTab />}
    </div>
  );
}

/* ---------------- Purchase orders ---------------- */

function PurchaseOrdersTab() {
  const { tenant } = useAuth();
  const toast = useToast();
  const money = makeMoney(tenant?.currency);
  const [pos, setPos] = useState(null);
  const [status, setStatus] = useState('all');
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState(null);
  const [suggestions, setSuggestions] = useState(null);

  async function load() {
    try {
      setPos(await api('/purchases', { query: { status } }));
    } catch (err) {
      toast.error(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [status]);

  async function openReceive(poId) {
    try {
      setReceiving(await api(`/purchases/${poId}`));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function loadSuggestions() {
    try {
      setSuggestions(await api('/purchases/suggestions'));
      setCreating(true);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="select select-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          {['all', 'draft', 'sent', 'partial', 'received', 'cancelled'].map((s) => (
            <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>
          ))}
        </select>
        <button className="btn btn-primary btn-sm ml-auto" onClick={() => setCreating(true)}>+ New purchase order</button>
        <button className="btn btn-outline btn-sm" onClick={loadSuggestions}>⚡ From reorder suggestions</button>
      </div>

      {!pos ? (
        <Spinner />
      ) : pos.length === 0 ? (
        <EmptyState icon="📦" title="No purchase orders" subtitle="Create one manually or from reorder suggestions." />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-base-100 shadow">
          <table className="table">
            <thead>
              <tr><th>Supplier</th><th>Status</th><th>Lines</th><th className="text-right">Cost</th><th>Created</th><th></th></tr>
            </thead>
            <tbody>
              {pos.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.supplierName}</td>
                  <td><span className={`badge badge-sm ${PO_STATUS[p.status] ?? 'badge-ghost'}`}>{p.status}</span></td>
                  <td>{p.lineCount}</td>
                  <td className="text-right font-semibold">{money(p.totalCost)}</td>
                  <td className="text-xs opacity-60">{fmtDateTime(p.createdAt)}</td>
                  <td className="text-right">
                    {['sent', 'partial'].includes(p.status) && (
                      <button className="btn btn-xs btn-primary" onClick={() => openReceive(p.id)}>Receive</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <POCreateModal
        open={!!creating}
        suggestions={suggestions}
        onClose={() => { setCreating(false); setSuggestions(null); }}
        onDone={() => { setCreating(false); setSuggestions(null); load(); }}
      />
      <ReceiveModal
        open={!!receiving}
        po={receiving}
        money={money}
        onClose={() => setReceiving(null)}
        onDone={() => { setReceiving(null); load(); }}
      />
    </div>
  );
}

function ProductPicker({ products, value, onChange }) {
  return (
    <select className="select select-sm w-full" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select product…</option>
      {products.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}{p.sku ? ` (${p.sku})` : ''} · stock {Number(p.stock)}
        </option>
      ))}
    </select>
  );
}

function POCreateModal({ open, suggestions, onClose, onDone }) {
  const toast = useToast();
  const { tenant } = useAuth();
  const money = makeMoney(tenant?.currency);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([{ productId: '', quantity: '', unitCost: '' }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([api('/suppliers'), api('/products')])
      .then(([s, p]) => {
        setSuppliers(s);
        setProducts(p.filter((x) => !x.parentId));
        if (s.length && !supplierId) setSupplierId(s[0].id);
      })
      .catch((err) => toast.error(err.message));
  }, [open]);

  useEffect(() => {
    if (suggestions?.length && products.length) {
      setSupplierId((cur) => cur || suppliers[0]?.id || '');
      setLines(
        suggestions.map((s) => ({
          productId: s.productId,
          quantity: String(s.suggestedQty),
          unitCost: String(s.lastCost ?? ''),
        }))
      );
    }
  }, [suggestions, products]);

  const valid =
    supplierId &&
    lines.every((l) => l.productId && Number(l.quantity) > 0 && Number(l.unitCost) >= 0);

  async function create() {
    setBusy(true);
    try {
      await api('/purchases', {
        method: 'POST',
        body: {
          supplierId,
          note: note || null,
          lines: lines.map((l) => ({
            productId: l.productId,
            quantity: Number(l.quantity),
            unitCost: Number(l.unitCost) || 0,
          })),
        },
      });
      toast.success('Purchase order created');
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New purchase order" wide>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Supplier">
            <select className="select select-md w-full" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select supplier…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Note">
            <input className="input input-md w-full" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </Field>
        </div>

        {lines.length === 0 && (
          <button
            className="btn btn-outline btn-sm"
            onClick={() => setLines([{ productId: '', quantity: '', unitCost: '' }])}
          >
            Add first line
          </button>
        )}
        <ul className="space-y-2">
          {lines.map((l, idx) => (
            <li key={idx} className="flex flex-wrap items-center gap-2 rounded-lg bg-base-200 p-2">
              <div className="min-w-40 flex-1"><ProductPicker products={products} value={l.productId}
                onChange={(v) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, productId: v } : x)))} /></div>
              <input type="number" min="0" step="0.001" placeholder="Qty" className="input input-sm w-24"
                value={l.quantity}
                onChange={(e) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))} />
              <input type="number" min="0" step="0.01" placeholder="Unit cost" className="input input-sm w-28"
                value={l.unitCost}
                onChange={(e) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, unitCost: e.target.value } : x)))} />
              <button className="btn btn-ghost btn-sm text-error"
                onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}>✕</button>
            </li>
          ))}
        </ul>
        <button className="btn btn-ghost btn-sm"
          onClick={() => setLines((ls) => [...ls, { productId: '', quantity: '', unitCost: '' }])}>
          + Add line
        </button>

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className={`btn btn-primary ${busy ? 'loading' : ''}`} disabled={!valid || busy} onClick={create}>
            Create order
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ReceiveModal({ open, po, money, onClose, onDone }) {
  const toast = useToast();
  const [qtys, setQtys] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && po) {
      setQtys(Object.fromEntries(po.lines.map((l) => [l.id, Math.max(l.quantity - l.receivedQty, 0)])));
    }
  }, [open, po]);

  if (!open || !po) return null;
  const entries = po.lines
    .map((l) => ({ lineId: l.id, quantity: Math.round((Number(qtys[l.id]) || 0) * 1000) / 1000 }))
    .filter((e) => e.quantity > 0);

  async function receive() {
    setBusy(true);
    try {
      const updated = await api(`/purchases/${po.id}/receive`, { method: 'POST', body: { lines: entries } });
      toast.success(`Received · status now "${updated.status}"`);
      onDone(updated);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Receive · ${po.supplierName}`} wide>
      <div className="space-y-2">
        {po.lines.map((l) => {
          const remaining = Math.round((l.quantity - l.receivedQty) * 1000) / 1000;
          return (
            <div key={l.id} className="flex items-center gap-3 rounded-lg bg-base-200 p-2 text-sm">
              <span className="flex-1 truncate font-medium">{l.productName}</span>
              <span className="text-xs opacity-60">ordered {l.quantity} · got {l.receivedQty} · {money(l.unitCost)}</span>
              <input type="number" min="0" max={remaining} step="0.001" className="input input-sm w-24 text-right"
                value={qtys[l.id] ?? 0}
                onChange={(e) => setQtys((q) => ({ ...q, [l.id]: Math.min(Math.max(Number(e.target.value) || 0, 0), remaining) }))} />
            </div>
          );
        })}
        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className={`btn btn-primary ${busy ? 'loading' : ''}`} disabled={entries.length === 0 || busy} onClick={receive}>
            Receive {entries.length} line{entries.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Suppliers ---------------- */

function SuppliersTab() {
  const toast = useToast();
  const [suppliers, setSuppliers] = useState(null);
  const [editing, setEditing] = useState(null);

  async function load() {
    try {
      setSuppliers(await api('/suppliers', { query: { includeInactive: 'true' } }));
    } catch (err) {
      toast.error(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>+ Add supplier</button>
      </div>
      {!suppliers ? (
        <Spinner />
      ) : suppliers.length === 0 ? (
        <EmptyState icon="🚚" title="No suppliers yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-base-100 shadow">
          <table className="table">
            <thead><tr><th>Name</th><th>Contact</th><th>Phone</th><th>Email</th><th className="text-right">POs</th><th></th></tr></thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className={!s.isActive ? 'opacity-50' : ''}>
                  <td className="font-medium">{s.name}</td>
                  <td>{s.contactName ?? '—'}</td>
                  <td>{s.phone ?? '—'}</td>
                  <td>{s.email ?? '—'}</td>
                  <td className="text-right">{s.orderCount}</td>
                  <td className="text-right">
                      <button aria-label={`Edit ${s.name}`} className="btn btn-ghost btn-xs" onClick={() => setEditing(s)}>✏️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SupplierModal
        open={!!editing}
        supplier={editing}
        onClose={() => setEditing(null)}
        onDone={() => { setEditing(null); load(); }}
      />
    </div>
  );
}

function SupplierModal({ open, supplier, onClose, onDone }) {
  const toast = useToast();
  const isNew = !supplier?.id;
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (open) {
      setForm({
        name: supplier?.name ?? '',
        contactName: supplier?.contactName ?? '',
        phone: supplier?.phone ?? '',
        email: supplier?.email ?? '',
      });
    }
  }, [open, supplier]);

  if (!open || !form) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    try {
      if (isNew) {
        await api('/suppliers', { method: 'POST', body: form });
        toast.success(`${form.name} added`);
      } else {
        await api(`/suppliers/${supplier.id}`, { method: 'PATCH', body: form });
        toast.success('Saved');
      }
      onDone();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'Add supplier' : `Edit ${supplier.name}`}>
      <div className="space-y-3">
        <Field label="Name"><input className="input input-md w-full" value={form.name} onChange={set('name')} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact person"><input className="input input-md w-full" value={form.contactName} onChange={set('contactName')} /></Field>
          <Field label="Phone"><input className="input input-md w-full" value={form.phone} onChange={set('phone')} /></Field>
        </div>
        <Field label="Email"><input type="email" className="input input-md w-full" value={form.email} onChange={set('email')} /></Field>
        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!form.name.trim()} onClick={save}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Stock counts ---------------- */

const r3 = (v) => Math.round(v * 1000) / 1000;

function CountsTab() {
  const { tenant } = useAuth();
  const toast = useToast();
  const money = makeMoney(tenant?.currency);
  const [counts, setCounts] = useState(null);
  const [active, setActive] = useState(null);
  const [creating, setCreating] = useState(false);
  const [categories, setCategories] = useState([]);

  async function load() {
    try {
      setCounts(await api('/counts'));
    } catch (err) {
      toast.error(err.message);
    }
  }

  useEffect(() => {
    load();
    api('/categories').then(setCategories).catch(() => {});
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ New cycle count</button>
      </div>

      {!counts ? (
        <Spinner />
      ) : counts.length === 0 ? (
        <EmptyState icon="📋" title="No counts yet" subtitle="A cycle count snapshots stock so you can audit variances." />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-base-100 shadow">
          <table className="table">
            <thead><tr><th>Scope</th><th>Status</th><th>Counted</th><th>Variance value</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {counts.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-base-200" onClick={async () => {
                  try { setActive(await api(`/counts/${c.id}`)); } catch (err) { toast.error(err.message); }
                }}>
                  <td className="font-medium">{c.categoryName ?? 'All products'}</td>
                  <td><span className={`badge badge-sm ${c.status === 'open' ? 'badge-warning' : c.status === 'applied' ? 'badge-success' : 'badge-ghost'}`}>{c.status}</span></td>
                  <td>{c.countedCount}/{c.lineCount}</td>
                  <td className="text-right">{c.varianceTotal != null ? money(Number(c.varianceTotal)) : '—'}</td>
                  <td className="text-xs opacity-60">{fmtDateTime(c.createdAt)}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CountCreateModal open={creating} categories={categories} onClose={() => setCreating(false)} onDone={(c) => { setCreating(false); setActive(c); load(); }} />

      <CountDetailModal open={!!active} count={active} money={money}
        onClose={() => setActive(null)}
        onChanged={(updated) => { setActive(updated); load(); }} />
    </div>
  );
}

function CountCreateModal({ open, categories, onClose, onDone }) {
  const toast = useToast();
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const c = await api('/counts', { method: 'POST', body: { categoryId: categoryId || null } });
      toast.success(`Count started (${c.lines.length} products)`);
      onDone(c);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New cycle count">
      <div className="space-y-3">
        <Field label="Scope">
          <select className="select select-md w-full" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All products</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <p className="text-xs opacity-60">System quantities are snapshotted now. Enter what you actually count, then apply.</p>
        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className={`btn btn-primary ${busy ? 'loading' : ''}`} disabled={busy} onClick={create}>Start count</button>
        </div>
      </div>
    </Modal>
  );
}

function CountDetailModal({ open, count, money, onClose, onChanged }) {
  const toast = useToast();
  const [entries, setEntries] = useState({});
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open && count) {
      setEntries(Object.fromEntries(count.lines.map((l) => [l.productId, l.countedQty])));
      setSearch('');
    }
  }, [open, count]);

  if (!open || !count) return null;
  const visible = count.lines.filter((l) => l.productName.toLowerCase().includes(search.toLowerCase()));

  async function save(applyAfter) {
    setBusy(true);
    try {
      let updated = count;
      if (count.status === 'open') {
        updated = await api(`/counts/${count.id}/lines`, {
          method: 'PUT',
          body: { entries: Object.entries(entries).map(([productId, v]) => ({ productId, countedQty: v === '' || v == null ? null : Number(v) })) },
        });
      }
      if (applyAfter) {
        const applied = await api(`/counts/${count.id}/apply`, { method: 'POST', body: {} });
        toast.success(`Applied ${applied.adjustments} adjustment${applied.adjustments === 1 ? '' : 's'} (${money(applied.varianceValue)})`);
        onChanged(applied);
      } else {
        toast.success('Progress saved');
        onChanged(updated);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Cycle count · ${count.categoryName ?? 'All products'}`} wide>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <span className={`badge badge-sm ${count.status === 'open' ? 'badge-warning' : count.status === 'applied' ? 'badge-success' : 'badge-ghost'}`}>{count.status}</span>
          <span className="opacity-60">{count.countedCount}/{count.lineCount} counted</span>
          <input className="input input-sm ml-auto w-44" placeholder="Filter…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {visible.map((l) => (
            <li key={l.productId} className="flex items-center gap-3 rounded-lg bg-base-200 p-2 text-sm">
              <span>{l.emoji}</span>
              <span className="flex-1 truncate">{l.productName}</span>
              <span className="font-mono text-xs opacity-60">sys {r3(l.systemQty)}</span>
              <input
                type="number" min="0" step="0.001" disabled={count.status !== 'open'}
                placeholder="counted"
                className="input input-sm w-24 text-right"
                value={entries[l.productId] ?? ''}
                onChange={(e) => setEntries((en) => ({ ...en, [l.productId]: e.target.value === '' ? null : e.target.value }))}
              />
              {l.variance != null && l.variance !== 0 && (
                <span className={`badge badge-xs ${l.variance < 0 ? 'badge-error' : 'badge-success'}`}>{r3(l.variance)}</span>
              )}
            </li>
          ))}
        </ul>
        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          {count.status === 'open' && (
            <>
              <button className={`btn ${busy ? 'loading' : ''}`} disabled={busy} onClick={() => save(false)}>Save progress</button>
              <button className={`btn btn-primary ${busy ? 'loading' : ''}`} disabled={busy} onClick={() => save(true)}>Apply adjustments</button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Transfers ---------------- */

function TransfersTab() {
  const toast = useToast();
  const { tenant } = useAuth();
  const money = makeMoney(tenant?.currency);
  const [locations, setLocations] = useState([]);
  const [products, setProducts] = useState([]);
  const [history, setHistory] = useState([]);
  const [form, setForm] = useState({ productId: '', from: '', to: '', quantity: '' });
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [locs, prods, hist] = await Promise.all([
        api('/locations'),
        api('/products'),
        api('/locations/transfers'),
      ]);
      setLocations(locs);
      setProducts(prods.filter((p) => !p.hasChildren));
      setHistory(hist);
    } catch (err) {
      toast.error(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const locLabel = (id) => (id === '' ? 'Main stock' : locations.find((l) => l.id === id)?.name ?? '?');

  async function transfer() {
    setBusy(true);
    try {
      const res = await api('/locations/transfers', {
        method: 'POST',
        body: {
          productId: form.productId,
          fromLocationId: form.from || null,
          toLocationId: form.to || null,
          quantity: Number(form.quantity),
        },
      });
      toast.success(`Moved ${res.quantity} × ${res.productName} → ${res.to}`);
      setForm({ productId: '', from: '', to: '', quantity: '' });
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = form.productId && form.from !== form.to && Number(form.quantity) > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <div className="card bg-base-100 p-4 shadow">
        <h3 className="mb-3 font-bold">Move stock</h3>
        <div className="space-y-3">
          <Field label="Product">
            <ProductPicker products={products} value={form.productId} onChange={(v) => setForm((f) => ({ ...f, productId: v }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <select className="select select-md w-full" value={form.from} onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}>
                <option value="">Main stock</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}{l.isDefault ? ' ★' : ''}</option>)}
              </select>
            </Field>
            <Field label="To">
              <select className="select select-md w-full" value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))}>
                <option value="">Main stock</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}{l.isDefault ? ' ★' : ''}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Quantity">
            <input type="number" min="0" step="0.001" className="input input-md w-full" value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
          </Field>
          <button className={`btn btn-primary btn-block ${busy ? 'loading' : ''}`} disabled={!canSubmit || busy} onClick={transfer}>
            Transfer
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-base-100 shadow">
        {history.length === 0 ? (
          <EmptyState icon="🔀" title="No transfers yet" />
        ) : (
          <table className="table">
            <thead><tr><th>Reference</th><th>Product</th><th className="text-right">Quantity</th><th>When</th></tr></thead>
            <tbody>
              {history.map((t) => (
                <tr key={t.reference}>
                  <td className="font-mono text-xs opacity-70">{t.reference}{t.note ? ` · ${t.note}` : ''}</td>
                  <td>{t.productName}</td>
                  <td className="text-right font-semibold">{t.quantity}</td>
                  <td className="text-xs opacity-60">{fmtDateTime(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

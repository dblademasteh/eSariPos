import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { makeMoney } from '../lib/format.js';
import { useAuth } from '../state/AuthContext.jsx';
import { EmptyState, Field, Modal, RoleBadge, Spinner, useToast } from '../components/ui.jsx';

const EMOJI_CHOICES = ['☕️', '🍵', '🥐', '🧁', '🍩', '🍪', '🍞', '🍫', '🥤', '🧊', '🍶', '👜', '🫘', '📦'];

export default function Products() {
  const { tenant, can } = useAuth();
  const toast = useToast();
  const money = makeMoney(tenant?.currency);
  const manage = can(2);

  const [products, setProducts] = useState(null);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const [recipesFor, setRecipesFor] = useState(null);
  const [catsOpen, setCatsOpen] = useState(false);

  async function load() {
    try {
      const [p, c] = await Promise.all([
        api('/products', { query: { includeInactive: String(includeInactive) } }),
        api('/categories'),
      ]);
      setProducts(p);
      setCategories(c);
    } catch (err) {
      toast.error(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [includeInactive]);

  const filtered = (products ?? []).filter(
    (p) =>
      !search.trim() ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-xl font-bold">Products</h1>
          <p className="text-sm opacity-60">{filtered.length} items</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            className="input input-sm w-48"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="label cursor-pointer gap-2 text-sm">
            <span className="opacity-70">Show inactive</span>
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              disabled={!manage}
            />
          </label>
          {manage && (
            <>
              <button className="btn btn-outline btn-sm" onClick={() => setCatsOpen(true)}>
                🏷️ Categories
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
                + New product
              </button>
            </>
          )}
        </div>
      </div>

      {!products ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState icon="📦" title="No products yet" subtitle={manage ? 'Create your first product.' : 'Ask a manager to add products.'} />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-base-100 shadow">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>SKU</th>
                <th className="text-right">Price</th>
                <th className="text-right">Stock</th>
                {manage && <th className="text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className={!p.isActive ? 'opacity-50' : ''}>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{p.emoji}</span>
                      <div>
                        <div className="font-medium">
                          {p.name}
                          {p.variantLabel && (
                            <span className="badge badge-ghost badge-sm ml-2">{p.variantLabel}</span>
                          )}
                          {p.hasChildren && <span className="badge badge-outline badge-sm ml-2">variant group</span>}
                        </div>
                        {p.barcode && <div className="text-xs opacity-50">{p.barcode}</div>}
                      </div>
                    </div>
                  </td>
                  <td>
                    {p.categoryName && (
                      <span
                        className="badge badge-sm whitespace-nowrap text-white"
                        style={{ background: p.categoryColor }}
                      >
                        {p.categoryName}
                      </span>
                    )}
                  </td>
                  <td className="font-mono text-xs">{p.sku ?? '—'}</td>
                  <td className="text-right font-semibold">{money(p.price)}</td>
                  <td className="text-right">
                    <span
                      className={`font-mono ${
                        Number(p.stock) === 0
                          ? 'font-bold text-error'
                          : p.stock <= p.lowStockThreshold
                            ? 'text-warning'
                            : ''
                      }`}
                    >
                      {Number(p.stock)}{p.unitLabel ? ` ${p.unitLabel}` : ''}
                    </span>
                    {p.hasRecipe && (
                      <div className="text-[10px] uppercase tracking-wide opacity-40">composite</div>
                    )}
                  </td>
                  {manage && (
                    <td className="text-right whitespace-nowrap">
                      <button aria-label={`Edit ${p.name}`} className="btn btn-ghost btn-xs" onClick={() => setEditing(p)}>
                        ✏️
                      </button>
                      <button aria-label={`Adjust stock for ${p.name}`} className="btn btn-ghost btn-xs" onClick={() => setAdjusting(p)}>
                        ±
                      </button>
                      {!p.parentId && (
                        <>
                          <button
                            aria-label={`Recipe for ${p.name}`}
                            title="Recipe / ingredients"
                            className="btn btn-ghost btn-xs"
                            onClick={() => setRecipesFor(p)}
                          >
                            🧪
                          </button>
                          <button
                            aria-label={`Add variant of ${p.name}`}
                            title="Add a variant of this product"
                            className="btn btn-ghost btn-xs"
                            onClick={() => setEditing({ __variantOf: p })}
                          >
                            ⧉
                          </button>
                        </>
                      )}
                      <input
                        type="checkbox"
                        className="toggle toggle-success toggle-xs ml-1 align-middle"
                        checked={p.isActive}
                        title={p.isActive ? 'Active' : 'Inactive'}
                        onChange={async (e) => {
                          try {
                            await api(`/products/${p.id}`, {
                              method: 'PATCH',
                              body: { isActive: e.target.checked },
                            });
                            load();
                          } catch (err) {
                            toast.error(err.message);
                          }
                        }}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProductModal
        open={!!editing}
        product={editing}
        categories={categories}
        products={products ?? []}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />

      <AdjustModal
        open={!!adjusting}
        product={adjusting}
        onClose={() => setAdjusting(null)}
        onSaved={() => {
          setAdjusting(null);
          load();
        }}
      />

      <RecipeModal
        open={!!recipesFor}
        product={recipesFor}
        products={products ?? []}
        onClose={() => setRecipesFor(null)}
      />

      <CategoriesModal open={catsOpen} onClose={() => setCatsOpen(false)} onChanged={load} />
    </div>
  );
}

function ProductModal({ open, product, categories, products, onClose, onSaved }) {
  const { tenant } = useAuth();
  const toast = useToast();
  const isNew = !product?.id;
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      const variantOf = product?.__variantOf ?? null;
      setForm({
        name: variantOf ? '' : product?.name ?? '',
        sku: product?.sku ?? '',
        barcode: product?.barcode ?? '',
        emoji: variantOf?.emoji ?? product?.emoji ?? '📦',
        categoryId: variantOf?.categoryId ?? product?.categoryId ?? '',
        price: product?.price ?? '',
        cost: product?.cost ?? 0,
        stock: 0,
        lowStockThreshold: product?.lowStockThreshold ?? 5,
        isActive: product?.isActive ?? true,
        parentId: variantOf ? variantOf.id : product?.parentId ?? '',
        variantLabel: '',
        soldBy: 'unit',
        unitLabel: '',
        reorderQty: 0,
      });
    }
  }, [open, product]);

  if (!open || !form) return null;
  const set = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        name: form.name,
        sku: form.sku || null,
        barcode: form.barcode || null,
        emoji: form.emoji,
        categoryId: form.categoryId || null,
        price: Number(form.price),
        cost: Number(form.cost),
        lowStockThreshold: Number(form.lowStockThreshold),
        isActive: form.isActive,
        parentId: form.parentId || null,
        variantLabel: form.variantLabel || null,
        soldBy: form.soldBy,
        unitLabel: form.unitLabel || null,
        reorderQty: Number(form.reorderQty) || 0,
      };
      if (isNew) body.stock = Number(form.stock) || 0;
      if (isNew) await api('/products', { method: 'POST', body });
      else await api(`/products/${product.id}`, { method: 'PATCH', body });
      toast.success(isNew ? 'Product created' : 'Product updated');
      onSaved();
    } catch (err) {
      const detail = Array.isArray(err.details) && err.details.length ? err.details[0].message : err.message;
      toast.error(detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'New product' : `Edit ${product.name}`}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Emoji">
          <div className="flex flex-wrap gap-1">
            {EMOJI_CHOICES.map((e) => (
              <button
                type="button"
                key={e}
                onClick={() => setForm((f) => ({ ...f, emoji: e }))}
                className={`rounded-lg border px-2 py-1 text-xl ${
                  form.emoji === e ? 'border-primary bg-primary/10' : 'border-base-300'
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Name">
          <input className="input input-md w-full" value={form.name} onChange={set('name')} required autoFocus />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU">
            <input className="input input-md w-full font-mono" value={form.sku} onChange={set('sku')} />
          </Field>
          <Field label="Barcode">
            <input className="input input-md w-full font-mono" value={form.barcode} onChange={set('barcode')} />
          </Field>
        </div>

        <Field label="Category">
          <select className="select select-md w-full" value={form.categoryId} onChange={set('categoryId')}>
            <option value="">— None —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label={`Price (${tenant?.currency})`}>
            <input type="number" step="0.01" min="0" className="input input-md w-full" value={form.price} onChange={set('price')} required />
          </Field>
          <Field label="Cost">
            <input type="number" step="0.01" min="0" className="input input-md w-full" value={form.cost} onChange={set('cost')} />
          </Field>
          <Field label="Low-stock at">
            <input type="number" min="0" className="input input-md w-full" value={form.lowStockThreshold} onChange={set('lowStockThreshold')} />
          </Field>
        </div>

        {isNew ? (
          <Field label="Opening stock">
            <input type="number" min="0" step="0.001" className="input input-md w-full" value={form.stock} onChange={set('stock')} />
          </Field>
        ) : (
          <p className="rounded-lg bg-base-200 p-2 text-xs opacity-70">
            Current stock: {Number(product.stock)}. Use the ± action to adjust stock so every change is logged.
          </p>
        )}

        <div className="grid grid-cols-3 gap-3 rounded-xl border border-base-300 p-3">
          <div className="col-span-3 text-xs font-semibold uppercase tracking-wide opacity-50">Variant / unit options</div>
          <Field label="Part of group">
            <select
              className="select select-md w-full"
              value={form.parentId}
              onChange={set('parentId')}
              disabled={!isNew && Boolean(product?.parentId)}
              title={product?.parentId ? 'Detach a variant by editing the parent linkage is not supported' : ''}
            >
              <option value="">— Standalone product —</option>
              {(products ?? [])
                .filter((p) => !p.parentId && p.id !== product?.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Variant label" hint='e.g. "Oat milk", "500 g"'>
            <input className="input input-md w-full" value={form.variantLabel} onChange={set('variantLabel')} />
          </Field>
          <Field label="Reorder qty" hint="Used for reorder suggestions">
            <input type="number" min="0" className="input input-md w-full" value={form.reorderQty} onChange={set('reorderQty')} />
          </Field>
          <Field label="Sold by">
            <select className="select select-md w-full" value={form.soldBy} onChange={set('soldBy')}>
              <option value="unit">Each (unit)</option>
              <option value="weight">Weight</option>
              <option value="length">Length</option>
            </select>
          </Field>
          <Field label="Unit label" hint='e.g. "g", "kg", "cm"'>
            <input className="input input-md w-full" value={form.unitLabel} onChange={set('unitLabel')} maxLength={8} />
          </Field>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="toggle toggle-sm" checked={form.isActive} onChange={set('isActive')} />
          Active (visible on register)
        </label>

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn btn-primary ${busy ? 'loading' : ''}`} disabled={busy}>
            {isNew ? 'Create' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AdjustModal({ open, product, onClose, onSaved }) {
  const toast = useToast();
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setDelta('');
      setNote('');
    }
  }, [open]);

  if (!open || !product) return null;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/products/${product.id}/adjust`, {
        method: 'POST',
        body: { delta: Number(delta), note: note || null },
      });
      toast.success('Stock adjusted');
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Adjust stock · ${product.name}`}>
      <form onSubmit={save} className="space-y-3">
        <p className="text-sm opacity-60">
          Current stock: <b>{product.stock}</b>
        </p>
        <Field label="Change (+/−)" hint="Negative numbers remove stock">
          <input
            type="number"
            className="input input-md w-full"
            placeholder="-2 or +12"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="Reason / note">
          <input className="input input-md w-full" placeholder="Delivery, breakage…" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn btn-primary ${busy ? 'loading' : ''}`} disabled={busy || !Number(delta)}>
            Apply
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RecipeModal({ open, product, products, onClose }) {
  const toast = useToast();
  const { tenant } = useAuth();
  const money = makeMoney(tenant?.currency);
  const [components, setComponents] = useState(null);
  const [pickId, setPickId] = useState('');
  const [pickQty, setPickQty] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && product?.id) {
      api(`/products/${product.id}/recipe`)
        .then(setComponents)
        .catch((err) => toast.error(err.message));
    }
  }, [open, product]);

  if (!open || !product) return null;
  const candidates = products.filter(
    (p) => p.id !== product.id && !p.parentId && !p.hasRecipe && !components?.some((c) => c.componentId === p.id)
  );
  const estCost = (components ?? []).reduce((s, c) => s + c.quantity * c.unitCost, 0);

  async function save(list) {
    setBusy(true);
    try {
      const fresh = await api(`/products/${product.id}/recipe`, {
        method: 'PUT',
        body: { components: list.map((c) => ({ componentId: c.componentId, quantity: Number(c.quantity) })) },
      });
      setComponents(fresh);
      toast.success('Recipe saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`🧪 Recipe · ${product.name}`} wide>
      <div className="space-y-3">
        <p className="text-xs opacity-60">
          Composite products are not stocked themselves — selling one deducts these ingredients instead.
          Estimated ingredient cost: <b>{money(Math.round(estCost * 100) / 100)}</b>
        </p>
        {!components ? (
          <Spinner />
        ) : (
          <>
            <ul className="space-y-2">
              {components.map((c) => (
                <li key={c.componentId} className="flex items-center gap-2 rounded-lg bg-base-200 p-2 text-sm">
                  <span>{c.emoji}</span>
                  <span className="flex-1 truncate font-medium">{c.name}</span>
                  <span className="font-mono text-xs opacity-50">stock {Number(c.stock)}</span>
                  <input
                    type="number" min="0" step="0.001"
                    className="input input-sm w-24 text-right"
                    value={c.quantity}
                    onChange={(e) =>
                      setComponents((cs) =>
                        cs.map((x) => (x.componentId === c.componentId ? { ...x, quantity: e.target.value } : x))
                      )
                    }
                  />
                  <button
                    className="btn btn-ghost btn-xs text-error"
                    onClick={() => save(components.filter((x) => x.componentId !== c.componentId))}
                  >
                    ✕
                  </button>
                </li>
              ))}
              {components.length === 0 && (
                <li className="rounded-lg bg-base-200 p-3 text-center text-sm opacity-60">
                  No ingredients yet — this product stocks and sells as a plain item.
                </li>
              )}
            </ul>

            <div className="flex flex-wrap items-end gap-2 border-t border-base-300 pt-3">
              <label className="flex-1">
                <span className="mb-1 block text-sm opacity-70">Add ingredient</span>
                <select className="select select-md w-full" value={pickId} onChange={(e) => setPickId(e.target.value)}>
                  <option value="">Select product…</option>
                  {candidates.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-sm opacity-70">Qty per sale</span>
                <input type="number" min="0" step="0.001" className="input input-md w-24" value={pickQty} onChange={(e) => setPickQty(e.target.value)} />
              </label>
              <button
                className={`btn btn-outline ${busy ? 'loading' : ''}`}
                disabled={!pickId || !(Number(pickQty) > 0)}
                onClick={() => {
                  save([...components, { componentId: pickId, quantity: pickQty }]);
                  setPickId('');
                  setPickQty('');
                }}
              >
                Add
              </button>
            </div>
          </>
        )}
        <div className="modal-action">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}

function CategoriesModal({ open, onClose, onChanged }) {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [newCat, setNewCat] = useState({ name: '', color: '#0d9488' });

  useEffect(() => {
    if (open) {
      api('/categories')
        .then(setList)
        .catch((err) => toast.error(err.message));
    }
  }, [open]);

  async function add(e) {
    e.preventDefault();
    try {
      await api('/categories', { method: 'POST', body: newCat });
      setNewCat({ name: '', color: '#0d9488' });
      const fresh = await api('/categories');
      setList(fresh);
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function update(cat) {
    try {
      await api(`/categories/${cat.id}`, { method: 'PATCH', body: { name: cat.name, color: cat.color } });
      toast.success('Saved');
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function remove(cat) {
    try {
      await api(`/categories/${cat.id}`, { method: 'DELETE' });
      setList((l) => l.filter((x) => x.id !== cat.id));
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Categories" wide>
      {!list ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <form onSubmit={add} className="flex flex-wrap items-end gap-2">
            <label className="flex-1">
              <span className="mb-1 block text-sm opacity-70">New category</span>
              <input
                className="input input-md w-full"
                placeholder="Name"
                value={newCat.name}
                onChange={(e) => setNewCat((c) => ({ ...c, name: e.target.value }))}
                required
              />
            </label>
            <label>
              <span className="mb-1 block text-sm opacity-70">Color</span>
              <input
                type="color"
                className="h-10 w-14 rounded border border-base-300"
                value={newCat.color}
                onChange={(e) => setNewCat((c) => ({ ...c, color: e.target.value }))}
              />
            </label>
            <button className="btn btn-primary btn-md">Add</button>
          </form>

          <ul className="space-y-2">
            {list.map((cat) => (
              <li key={cat.id} className="flex items-center gap-2 rounded-lg bg-base-200 p-2">
                <input
                  type="color"
                  className="h-9 w-11 shrink-0 rounded border border-base-300"
                  value={cat.color}
                  onChange={(e) => setList((l) => l.map((c) => (c.id === cat.id ? { ...c, color: e.target.value } : c)))}
                />
                <input
                  className="input input-sm flex-1"
                  value={cat.name}
                  onChange={(e) => setList((l) => l.map((c) => (c.id === cat.id ? { ...c, name: e.target.value } : c)))}
                />
                <span className="whitespace-nowrap text-xs opacity-50">{cat.productCount} products</span>
                <button className="btn btn-ghost btn-xs" onClick={() => update(cat)}>
                  💾
                </button>
                <button className="btn btn-ghost btn-xs text-error" onClick={() => remove(cat)}>
                  🗑️
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

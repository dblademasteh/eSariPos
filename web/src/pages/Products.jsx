import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { makeMoney } from '../lib/format.js';
import { useAuth } from '../state/AuthContext.jsx';
import { EmptyState, Field, Modal, Spinner, useToast } from '../components/ui.jsx';
import { Tag, Pencil, FlaskConical, X, Save, Trash2, ArrowUpDown, Layers, Package } from 'lucide-react';

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
      <div className="receipt-head">
        <div className="receipt-meta">
          <span className="font-bold">{tenant?.name}</span>
          <span className="dot" aria-hidden="true"></span>
          <span>{new Date().toLocaleDateString()}</span>
        </div>
        <h1 className="text-xl font-bold">Products</h1>
        <p className="text-sm text-mute">{filtered.length} items</p>
        <div className="ml-auto flex flex-wrap items-center gap-2 mt-2">
          <input
            className="input-field input-sm w-48 text-ink"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="label cursor-pointer gap-2 text-sm text-ink">
            <span className="text-mute">Show inactive</span>
            <input
              type="checkbox"
              className="toggle-field toggle-sm"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              disabled={!manage}
            />
          </label>
          {manage && (
            <>
              <button className="btn-outline btn-sm text-ink border-line hover:bg-panel hover:text-ink" onClick={() => setCatsOpen(true)}>
                <Tag className="mr-1 inline h-4 w-4" /> Categories
              </button>
              <button className="btn-cta btn-sm" onClick={() => setEditing({})}>
                + New product
              </button>
            </>
          )}
        </div>
      </div>

      {!products ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Package className="mx-auto h-12 w-12 text-mute" />} title="No products yet" subtitle={manage ? 'Create your first product.' : 'Ask a manager to add products.'} />
      ) : (
        <div className="overflow-x-auto card-counter">
          <table className="table-counter">
            <thead>
              <tr>
                <th className="text-ink">Product</th>
                <th className="text-ink">Category</th>
                <th className="text-ink">SKU</th>
                <th className="text-right text-ink">Price</th>
                <th className="text-right text-ink">Stock</th>
                {manage && <th className="text-right text-ink">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className={!p.isActive ? 'text-mute' : ''}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="font-medium text-ink">
                          {p.name}
                          {p.variantLabel && (
                            <span className="badge-pill badge-sm text-mute ml-2">{p.variantLabel}</span>
                          )}
                          {p.hasChildren && <span className="badge-pill badge-sm text-mute ml-2">variant group</span>}
                        </div>
                        {p.barcode && <div className="text-xs text-mute">{p.barcode}</div>}
                      </div>
                    </div>
                  </td>
                  <td>
                    {p.categoryName && (
                      <span className="badge-pill fill-accent badge-sm whitespace-nowrap" style={{ background: p.categoryColor }}>
                        {p.categoryName}
                      </span>
                    )}
                  </td>
                  <td className="font-data text-xs text-ink">{p.sku ?? '—'}</td>
                  <td className="text-right font-semibold text-ink">{money(p.price)}</td>
                  <td className="text-right">
                    <span
                      className={`font-data ${
                        Number(p.stock) === 0
                          ? 'font-bold text-warn'
                          : p.stock <= p.lowStockThreshold
                            ? 'text-warn'
                            : ''
                      }`}
                    >
                      {Number(p.stock)}{p.unitLabel ? ` ${p.unitLabel}` : ''}
                    </span>
                    {p.hasRecipe && (
                      <div className="text-[10px] uppercase tracking-wide text-mute">composite</div>
                    )}
                  </td>
                  {manage && (
                    <td className="text-right whitespace-nowrap">
                      <button aria-label={`Edit ${p.name}`} className="btn-ghost btn-xs text-mute hover:bg-panel hover:text-ink" onClick={() => setEditing(p)}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button aria-label={`Adjust stock for ${p.name}`} className="btn-ghost btn-xs text-mute hover:bg-panel hover:text-ink" onClick={() => setAdjusting(p)}>
                        <ArrowUpDown className="h-4 w-4" />
                      </button>
                      {!p.parentId && (
                        <>
                          <button
                            aria-label={`Recipe for ${p.name}`}
                            title="Recipe / ingredients"
                            className="btn-ghost btn-xs text-mute hover:bg-panel hover:text-ink"
                            onClick={() => setRecipesFor(p)}
                          >
                            <FlaskConical className="h-4 w-4" />
                          </button>
                          <button
                            aria-label={`Add variant of ${p.name}`}
                            title="Add a variant of this product"
                            className="btn-ghost btn-xs text-mute hover:bg-panel hover:text-ink"
                            onClick={() => setEditing({ __variantOf: p })}
                          >
                            <Layers className="h-4 w-4" />
                          </button>
                        </>
                      )}
                      <input
                        type="checkbox"
                        className="toggle-field toggle-xs ml-1 align-middle"
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
        <Field label="Name">
          <input className="input-field input-md w-full text-ink" value={form.name} onChange={set('name')} required autoFocus />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU">
            <input className="input input-md w-full font-data text-ink" value={form.sku} onChange={set('sku')} />
          </Field>
          <Field label="Barcode">
            <input className="input input-md w-full font-data text-ink" value={form.barcode} onChange={set('barcode')} />
          </Field>
        </div>

        <Field label="Category">
          <select className="select-field input-md w-full text-ink" value={form.categoryId} onChange={set('categoryId')}>
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
            <input type="number" step="0.01" min="0" className="input-field input-md w-full text-ink" value={form.price} onChange={set('price')} required />
          </Field>
          <Field label="Cost">
            <input type="number" step="0.01" min="0" className="input-field input-md w-full text-ink" value={form.cost} onChange={set('cost')} />
          </Field>
          <Field label="Low-stock at">
            <input type="number" min="0" className="input-field input-md w-full text-ink" value={form.lowStockThreshold} onChange={set('lowStockThreshold')} />
          </Field>
        </div>

        {isNew ? (
          <Field label="Opening stock">
            <input type="number" min="0" step="0.001" className="input-field input-md w-full text-ink" value={form.stock} onChange={set('stock')} />
          </Field>
        ) : (
          <p className="rounded-lg bg-panel p-2 text-xs text-mute">
            Current stock: {Number(product.stock)}. Use the ± action to adjust stock so every change is logged.
          </p>
        )}

        <div className="grid grid-cols-3 gap-3 rounded-xl border border-line p-3">
          <div className="col-span-3 text-xs font-semibold uppercase tracking-wide text-mute">Variant / unit options</div>
          <Field label="Part of group">
            <select
              className="select-field input-md w-full text-ink"
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
            <input className="input-field input-md w-full text-ink" value={form.variantLabel} onChange={set('variantLabel')} />
          </Field>
          <Field label="Reorder qty" hint="Used for reorder suggestions">
            <input type="number" min="0" className="input-field input-md w-full text-ink" value={form.reorderQty} onChange={set('reorderQty')} />
          </Field>
          <Field label="Sold by">
            <select className="select-field input-md w-full text-ink" value={form.soldBy} onChange={set('soldBy')}>
              <option value="unit">Each (unit)</option>
              <option value="weight">Weight</option>
              <option value="length">Length</option>
            </select>
          </Field>
          <Field label="Unit label" hint='e.g. "g", "kg", "cm"'>
            <input className="input-field input-md w-full text-ink" value={form.unitLabel} onChange={set('unitLabel')} maxLength={8} />
          </Field>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="toggle-field toggle-sm" checked={form.isActive} onChange={set('isActive')} />
          Active (visible on register)
        </label>

        <div className="modal-action">
          <button type="button" className="btn-ghost text-mute hover:bg-panel hover:text-ink" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn-cta ${busy ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={busy}>
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
        <p className="text-sm text-mute">
          Current stock: <b className="text-ink">{product.stock}</b>
        </p>
        <Field label="Change (+/−)" hint="Negative numbers remove stock">
          <input
            type="number"
            className="input-field input-md w-full text-ink"
            placeholder="-2 or +12"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="Reason / note">
          <input className="input-field input-md w-full text-ink" placeholder="Delivery, breakage…" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="modal-action">
          <button type="button" className="btn-ghost text-mute hover:bg-panel hover:text-ink" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn-cta ${busy ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={busy || !Number(delta)}>
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
    <Modal open={open} onClose={onClose} title={`Recipe · ${product.name}`} wide>
      <div className="space-y-3">
        <p className="text-xs text-mute">
          Composite products are not stocked themselves — selling one deducts these ingredients instead.
          Estimated ingredient cost: <b className="text-ink">{money(Math.round(estCost * 100) / 100)}</b>
        </p>
        {!components ? (
          <Spinner />
        ) : (
          <>
            <ul className="space-y-2">
              {components.map((c) => (
                <li key={c.componentId} className="flex items-center gap-2 rounded-lg bg-panel p-2 text-sm">
                  <span className="flex-1 truncate font-medium text-ink">{c.name}</span>
                  <span className="font-data text-xs text-mute">stock {Number(c.stock)}</span>
                  <input
                    type="number" min="0" step="0.001"
                    className="input input-sm w-24 text-right text-ink"
                    value={c.quantity}
                    onChange={(e) =>
                      setComponents((cs) =>
                        cs.map((x) => (x.componentId === c.componentId ? { ...x, quantity: e.target.value } : x))
                      )
                    }
                  />
                  <button
className="btn-ghost btn-xs text-warn"
                    onClick={() => save(components.filter((x) => x.componentId !== c.componentId))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
              {components.length === 0 && (
                <li className="rounded-lg bg-panel p-3 text-center text-sm text-mute">
                  No ingredients yet — this product stocks and sells as a plain item.
                </li>
              )}
            </ul>

            <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <label className="flex-1">
                <span className="mb-1 block text-sm text-mute">Add ingredient</span>
                <select className="select-field input-md w-full text-ink" value={pickId} onChange={(e) => setPickId(e.target.value)}>
                  <option value="">Select product…</option>
                  {candidates.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-sm text-mute">Qty per sale</span>
                <input type="number" min="0" step="0.001" className="input input-md w-24 text-ink" value={pickQty} onChange={(e) => setPickQty(e.target.value)} />
              </label>
              <button
                className={`btn-outline text-ink border-line hover:bg-panel hover:text-ink ${busy ? 'opacity-50 cursor-not-allowed' : ''}`}
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
          <button className="btn-cta" onClick={onClose}>Done</button>
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
              <span className="mb-1 block text-sm text-mute">New category</span>
              <input
                className="input-field input-md w-full text-ink"
                placeholder="Name"
                value={newCat.name}
                onChange={(e) => setNewCat((c) => ({ ...c, name: e.target.value }))}
                required
              />
            </label>
            <label>
              <span className="mb-1 block text-sm text-mute">Color</span>
              <input
                type="color"
                className="h-10 w-14 rounded border border-line"
                value={newCat.color}
                onChange={(e) => setNewCat((c) => ({ ...c, color: e.target.value }))}
              />
            </label>
            <button className="btn-cta btn-md">Add</button>
          </form>

          <ul className="space-y-2">
            {list.map((cat) => (
              <li key={cat.id} className="flex items-center gap-2 rounded-lg bg-panel p-2">
                <input
                  type="color"
                  className="h-9 w-11 shrink-0 rounded border border-line"
                  value={cat.color}
                  onChange={(e) => setList((l) => l.map((c) => (c.id === cat.id ? { ...c, color: e.target.value } : c)))}
                />
                <input
                  className="input input-sm flex-1 text-ink"
                  value={cat.name}
                  onChange={(e) => setList((l) => l.map((c) => (c.id === cat.id ? { ...c, name: e.target.value } : c)))}
                />
                <span className="whitespace-nowrap text-xs text-mute">{cat.productCount} products</span>
                <button className="btn-ghost btn-xs text-mute hover:bg-panel hover:text-ink" onClick={() => update(cat)}>
                  <Save className="h-4 w-4" />
                </button>
                <button className="btn btn-ghost btn-xs text-warn" onClick={() => remove(cat)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

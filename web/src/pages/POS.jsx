import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { fmtDateTime, makeMoney } from '../lib/format.js';
import { enqueueSale, flushQueue } from '../lib/offlineQueue.js';
import { getLocationId } from '../lib/registerLocation.js';
import { useAuth } from '../state/AuthContext.jsx';
import { EmptyState, Field, Modal, Spinner, useToast } from '../components/ui.jsx';
import Receipt from '../components/Receipt.jsx';
import CashDrawer from '../components/CashDrawer.jsx';
import { kickCashDrawer } from '../lib/hardware.js';
import { Search, Ticket, X, Printer, Banknote, CreditCard, Monitor, Smartphone, Send, CircleDot, QrCode, Landmark } from 'lucide-react';

export default function POS() {
  const { tenant, user, hasPerm, can } = useAuth();
  const toast = useToast();
  const money = makeMoney(tenant?.currency);

  const [products, setProducts] = useState(null);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState('');
  const [discountType, setDiscountType] = useState('regular');
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [beneficiaryIdNumber, setBeneficiaryIdNumber] = useState('');
  const [beneficiaryIdType, setBeneficiaryIdType] = useState('senior_id');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState(null);
  const [variantParent, setVariantParent] = useState(null);
  const [qtyFor, setQtyFor] = useState(null);
  const [heldOpen, setHeldOpen] = useState(false);
  const [held, setHeld] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('novapos.held')) ?? [];
    } catch {
      return [];
    }
  });
  const searchRef = useRef(null);
  let tax, total;

  function persistHeld(next) {
    setHeld(next);
    localStorage.setItem('novapos.held', JSON.stringify(next));
  }

  function holdTicket() {
    if (cart.length === 0) return;
    persistHeld([
      ...held,
      {
        id: crypto.randomUUID(),
        ts: Date.now(),
        discount,
        discountType,
        beneficiaryName,
        beneficiaryIdNumber,
        beneficiaryIdType,
        total: Math.round((total) * 100) / 100,
        lines: cart.map((l) => ({ product: { ...l.product }, qty: l.qty })),
      },
    ]);
    setCart([]);
    setDiscount('');
    setDiscountType('regular');
    setBeneficiaryName('');
    setBeneficiaryIdNumber('');
    setBeneficiaryIdType('senior_id');
    toast.info('Ticket parked');
  }

  function recallTicket(ticket) {
    setCart(ticket.lines);
    setDiscount(ticket.discount ?? '');
    setDiscountType(ticket.discountType ?? 'regular');
    setBeneficiaryName(ticket.beneficiaryName ?? '');
    setBeneficiaryIdNumber(ticket.beneficiaryIdNumber ?? '');
    setBeneficiaryIdType(ticket.beneficiaryIdType ?? 'senior_id');
    persistHeld(held.filter((h) => h.id !== ticket.id));
    setHeldOpen(false);
  }

  useEffect(() => {
    Promise.all([api('/products'), api('/categories')])
      .then(([p, c]) => {
        setProducts(p);
        setCategories(c);
      })
      .catch((err) => toast.error(err.message));
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const visible = useMemo(() => {
    if (!products) return [];
    const searching = Boolean(search.trim());
    let list = searching
      ? products
      : products.filter((p) => !p.parentId);
    if (activeCategory) list = list.filter((p) => p.categoryId === activeCategory);
    if (searching) {
      const q = search.trim().toLowerCase();
      const exact = list.find((p) => p.sku?.toLowerCase() === q || p.barcode?.toLowerCase() === q);
      if (exact && q.length >= 3) return [exact];
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.variantLabel ?? '').toLowerCase().includes(q) ||
          p.sku?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [products, activeCategory, search]);

  function handlePick(product) {
    if (product.hasChildren) {
      setVariantParent(product);
      return;
    }
    if (product.soldBy !== 'unit') {
      setQtyFor(product);
      return;
    }
    addToCart(product);
  }

  function addToCart(product, qty = 1) {
    const eps = 1e-9;
    const oversell = tenant?.allowNegativeStock === true;
    setCart((c) => {
      const existing = c.find((l) => l.product.id === product.id);
      if (existing) {
        if (!oversell && existing.qty + qty > product.stock + eps) {
          toast.error(`Only ${Number(product.stock)} × ${product.name} in stock`);
          return c;
        }
        return c.map((l) => (l.product.id === product.id ? { ...l, qty: Math.round((l.qty + qty) * 1000) / 1000 } : l));
      }
      if (!oversell && qty > product.stock + eps) {
        toast.error(`Only ${Number(product.stock)} × ${product.name} in stock`);
        return c;
      }
      return [...c, { product, qty }];
    });
  }

  function setQty(productId, qty) {
    const oversell = tenant?.allowNegativeStock === true;
    setCart((c) =>
      qty <= 0
        ? c.filter((l) => l.product.id !== productId)
        : c.map((l) =>
            l.product.id === productId
              ? { ...l, qty: oversell ? qty : Math.min(qty, Number(l.product.stock)) }
              : l
          )
    );
  }

  const subtotal = cart.reduce((s, l) => s + l.product.price * l.qty, 0);
  const isScPwd = discountType === 'senior' || discountType === 'pwd';
  const maxPct = can(3) ? 100 : Math.min(Math.max(Number(tenant?.maxDiscountPct ?? 100), 0), 100);
  let discountNum;
  if (isScPwd) {
    discountNum = Math.round(subtotal * 20) / 100;
  } else if (discountType === 'percentage') {
    const pct = Math.min(Math.max(Number(discount) || 0, 0), maxPct);
    discountNum = Math.round(subtotal * pct) / 100;
  } else {
    discountNum = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  }
  const taxRate = Number(tenant?.taxRate ?? 0);
  const taxInclusive = tenant?.taxInclusive ?? false;

  if (taxInclusive) {
    tax = Math.round(((subtotal - discountNum) * taxRate) / (100 + taxRate) * 100) / 100;
    total = Math.max(subtotal - discountNum, 0);
  } else {
    tax = Math.round(((subtotal - discountNum) * taxRate * 100) / 100) / 100;
    total = Math.max(subtotal - discountNum + tax, 0);
  }

  async function handlePaid(order) {
    setPaymentOpen(false);
    setCart([]);
    setDiscount('');
    setDiscountType('regular');
    setBeneficiaryName('');
    setBeneficiaryIdNumber('');
    setBeneficiaryIdType('senior_id');
    if (tenant?.autoPrintReceipt !== false) setReceiptOrder(order);
    toast.success(`Sale #${order.orderNo} complete`);
    setProducts((ps) => ps.map((p) => {
      const line = order.items.find((i) => i.productId === p.id);
      return line ? { ...p, stock: Math.max(p.stock - line.quantity, 0) } : p;
    }));
    flushQueue().catch(() => {});
    if (tenant?.openDrawerOnCash !== false && (order.payments ?? []).some((p) => p.method === 'cash')) {
      kickCashDrawer().catch(() => {});
    }
  }

  function handleQueued() {
    setPaymentOpen(false);
    setCart([]);
    setDiscount('');
    setDiscountType('regular');
    setBeneficiaryName('');
    setBeneficiaryIdNumber('');
    setBeneficiaryIdType('senior_id');
    toast.info('Sale saved offline — it will sync automatically');
  }

  useEffect(() => {
    try {
      const ch = new BroadcastChannel('novapos-register');
      const lines = cart.map((l) => ({
        name: l.product.name + (l.product.variantLabel ? ` · ${l.product.variantLabel}` : ''),
        qty: l.qty,
        lineTotal: Math.round(l.product.price * l.qty * 100) / 100,
      }));
      ch.postMessage({ type: 'cart', lines, total: Math.round(total * 100) / 100 });
      return () => ch.close();
    } catch {
      return undefined;
    }
  }, [cart, total]);

  if (!products) return <Spinner label="Loading register…" />;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[1fr_400px]">
      <section className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={searchRef}
            className="input-field input-md w-full max-w-xs text-ink"
            placeholder="Search or scan… (/)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && visible.length > 0) {
                handlePick(visible[0]);
                setSearch('');
              }
            }}
            autoComplete="off"
            aria-label="Search products"
          />
          <div className="flex items-center gap-1">
            <button
              className={`btn-cta btn-xs ${activeCategory === '' ? '' : 'opacity-50'}`}
              onClick={() => setActiveCategory('')}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                className={`flex items-center gap-1.5 btn-ghost btn-xs text-ink border border-line rounded-lg hover:bg-panel hover:text-accent ${activeCategory === c.id ? 'bg-accent-dim text-accent border-accent' : ''}`}
                onClick={() => setActiveCategory(c.id)}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: c.color }}></span>
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          {visible.length === 0 ? (
            <EmptyState icon={<Search className="mx-auto h-12 w-12 text-mute" />} title="No products match" subtitle="Try another search or category." />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {visible.map((p) => {
                const out = p.stock <= 0;
                const low = !out && p.stock <= p.lowStockThreshold;
                const inCart = cart.find((l) => l.product.id === p.id)?.qty ?? 0;
                return (
                  <button
                    key={p.id}
                    disabled={out}
                    onClick={() => handlePick(p)}
                    className={`card-counter relative border border-line bg-paper text-left transition hover:border-accent/50 ${
                      out ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="p-3 text-center">
                      {(out || low) && (
                        <span className={`badge-pill badge-sm absolute right-2 top-2 ${out ? 'fill-warn' : 'warn'}`}>
                          {out ? 'Out' : `${Number(p.stock)} left`}
                        </span>
                      )}
                      {inCart > 0 && (
                        <span className="badge-pill badge-sm fill-accent absolute left-2 top-2">{inCart}</span>
                      )}
                      <span className="line-clamp-2 min-h-[2rem] text-sm font-medium leading-4 text-ink">{p.name}</span>
                      {p.variantLabel && <span className="text-[10px] uppercase text-mute">{p.variantLabel}</span>}
                      <span className="text-sm font-bold text-accent font-data block mt-1">
                        {money(p.price)}{p.unitLabel ? ` / ${p.unitLabel}` : ''}
                      </span>
                      {p.hasChildren && <span className="text-[10px] text-mute">tap to pick variant</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <aside className="card-counter order-first h-fit bg-paper lg:order-none lg:sticky lg:top-0 lg:-top-4">
        <div className="gap-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold tracking-tight text-ink">Current sale</h2>
            <div className="flex items-center gap-1">
              {held.length > 0 && (
                <button className="btn-ghost btn-xs" onClick={() => setHeldOpen(true)} title="View parked tickets">
                  <Ticket className="h-4 w-4" aria-hidden="true" /> {held.length}
                </button>
              )}
              {cart.length > 0 && (
                <>
                  <button className="btn-ghost btn-xs" onClick={holdTicket} title="Park this ticket">
                    Hold
                  </button>
                  <button className="btn-ghost btn-xs text-warn" onClick={() => setCart([])} title="Clear cart">
                    Clear
                  </button>
                </>
              )}
              <CashDrawer />
            </div>
          </div>

          {cart.length === 0 ? (
            <p className="py-8 text-center text-xs text-mute">Tap products to add them.</p>
          ) : (
            <ul className="max-h-[20rem] space-y-2 overflow-y-auto">
              {cart.map((l) => (
                <li key={l.product.id} className="flex items-center gap-2 rounded-lg bg-panel p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {l.product.name}
                      {l.product.variantLabel && <span className="ml-1 text-xs text-mute">· {l.product.variantLabel}</span>}
                    </div>
                    <div className="text-xs text-mute">{money(l.product.price)} ea</div>
                  </div>
                  {l.product.soldBy !== 'unit' ? (
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      max={l.product.stock}
                      className="input-field input-xs w-20 text-right font-data text-ink"
                      value={l.qty}
                      onChange={(e) => {
                        const v = Math.min(Math.max(Number(e.target.value) || 0, 0), l.product.stock);
                        setQty(l.product.id, Math.round(v * 1000) / 1000);
                      }}
                    />
                  ) : (
                    <div className="flex items-center gap-1">
                      <button aria-label="Decrease quantity" className="btn-ghost btn-xs min-h-[2.5rem] min-w-[2.5rem] px-0" onClick={() => setQty(l.product.id, l.qty - 1)}>-</button>
                      <span aria-live="polite" className="btn-ghost btn-xs min-h-[2.5rem] w-[2.5rem] px-0 font-data text-ink pointer-events-none text-center">{l.qty}</span>
                      <button
                        aria-label="Increase quantity"
                        className="btn-ghost btn-xs min-h-[2.5rem] min-w-[2.5rem] px-0"
                        onClick={() => setQty(l.product.id, l.qty + 1)}
                        disabled={l.qty >= l.product.stock}
                      >
                        +
                      </button>
                    </div>
                  )}
                  <span className="w-16 text-right text-sm font-semibold font-data text-ink">{money(l.product.price * l.qty)}</span>
                </li>
              ))}
            </ul>
          )}
        <div className="space-y-2">
          <div className="field">
              <label className="mb-1 flex items-center justify-between text-xs text-mute">
                <span>Discount type</span>
                {!hasPerm('discounts') && <span className="badge-pill badge-sm text-mute border border-line">no permission</span>}
              </label>
              <select
                className={`select-field input-sm w-full text-ink ${hasPerm('discounts') ? '' : 'opacity-50 cursor-not-allowed'}`}
                value={discountType}
                disabled={!hasPerm('discounts')}
                onChange={(e) => {
                  setDiscountType(e.target.value);
                  setDiscount('');
                }}
              >
                <option value="regular">Regular ($)</option>
                <option value="senior">Senior Citizen (20%)</option>
                <option value="pwd">PWD (20%)</option>
                <option value="percentage">Percentage (%)</option>
                <option value="employee">Employee discount ($)</option>
              </select>
            </div>
            {discountType !== 'senior' && discountType !== 'pwd' && (
              <div className="field">
                <label className="mb-1 text-xs text-mute">
                  {discountType === 'percentage' ? `Discount (%)${maxPct < 100 ? ` · max ${maxPct}%` : ''}` : 'Discount ($)'}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={`input-field input-sm w-full text-ink ${hasPerm('discounts') ? '' : 'opacity-50 cursor-not-allowed'}`}
                  placeholder={discountType === 'percentage' ? '0' : '0.00'}
                  value={discountType === 'percentage' ? discount : (hasPerm('discounts') ? discount : '')}
                  disabled={!hasPerm('discounts')}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </div>
            )}
            {(discountType === 'senior' || discountType === 'pwd') && (
              <div className="space-y-2 rounded-lg bg-warn-dim p-2 text-xs border border-warn/20">
                <div className="font-bold text-warn">
                  {discountType === 'senior' ? 'Senior Citizen' : 'PWD'} — 20% discount + VAT exempt
                </div>
                <div className="flex items-end gap-2">
                  <label className="text-[10px] uppercase tracking-wider text-mute block">Beneficiary full name</label>
                  <input
                    className="input-field input-xs w-full text-ink"
                    placeholder="Beneficiary full name"
                    value={beneficiaryName}
                    onChange={(e) => setBeneficiaryName(e.target.value)}
                  />
                </div>
                <div className="flex gap-1 items-end">
                  <label className="text-[10px] uppercase tracking-wider text-mute block w-24">ID type</label>
                  <select
                    className="select-field input-xs w-24 text-ink"
                    value={beneficiaryIdType}
                    onChange={(e) => setBeneficiaryIdType(e.target.value)}
                  >
                    <option value="senior_id">Senior ID</option>
                    <option value="pwd_id">PWD ID</option>
                    <option value="postal">Postal</option>
                    <option value="other">Other</option>
                  </select>
                  <div className="flex-1">
                    <label className="text-[10px] uppercase tracking-wider text-mute block">ID number</label>
                    <input
                      className="input-field input-xs w-full text-ink"
                      placeholder="ID number"
                      value={beneficiaryIdNumber}
                      onChange={(e) => setBeneficiaryIdNumber(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1 border-t border-line pt-3 text-sm">
            <div className="flex justify-between">
              <span className="text-mute">Subtotal</span>
              <span className="font-data text-ink">{money(subtotal)}</span>
            </div>
            {discountNum > 0 && (
              <div className="flex justify-between">
                <span className="text-mute">{isScPwd ? `${discountType === 'senior' ? 'Senior' : 'PWD'} (20%)` : 'Discount'}</span>
                <span className="font-data text-warn">-{money(discountNum)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-mute">Tax ({taxRate}%)</span>
              <span className="font-data text-ink">{money(tax)}</span>
            </div>
            <div className="flex justify-between pt-1 text-lg font-bold text-ink">
              <span>Total</span>
              <span className="font-data">{money(total)}</span>
            </div>
          </div>

          <button
            className="btn-cta btn-block"
            disabled={cart.length === 0 || total <= 0}
            onClick={() => setPaymentOpen(true)}
          >
            Charge {money(total)}
          </button>
          <p className="text-center text-xs text-mute">
            Signed in as {user?.name} · {tenant?.name}
          </p>
        </div>
      </aside>

      <Modal open={!!variantParent} onClose={() => setVariantParent(null)} title={variantParent ? `Choose ${variantParent.name}` : ''}>
        {variantParent && (
          <ul className="space-y-2">
            {products
              .filter((p) => p.parentId === variantParent.id && p.isActive)
              .map((v) => (
                <li key={v.id}>
                  <button
                    className={`btn-ghost btn-block justify-between ${v.stock <= 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                    disabled={v.stock <= 0}
                    onClick={() => {
                      setVariantParent(null);
                      handlePick(v);
                    }}
                  >
                    <span>{v.variantLabel || v.name}</span>
                    <span className="font-bold text-ink">{money(v.price)}</span>
                  </button>
                </li>
              ))}
            {products.filter((p) => p.parentId === variantParent.id && p.isActive).length === 0 && (
              <p className="text-center text-sm text-mute">No active variants yet.</p>
            )}
          </ul>
        )}
      </Modal>

      <WeightPrompt
        product={qtyFor}
        money={money}
        onClose={() => setQtyFor(null)}
        onConfirm={(qty) => {
          addToCart(qtyFor, qty);
          setQtyFor(null);
        }}
      />

      <PaymentModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        total={total}
        cart={cart}
        discount={discountNum}
        discountType={discountType}
        beneficiaryName={beneficiaryName}
        beneficiaryIdNumber={beneficiaryIdNumber}
        beneficiaryIdType={beneficiaryIdType}
        onPaid={handlePaid}
        onQueued={handleQueued}
      />

      <Modal open={heldOpen} onClose={() => setHeldOpen(false)} title={`Held tickets · ${held.length}`}>
        {held.length === 0 ? (
          <p className="py-4 text-center text-sm text-mute">Nothing parked.</p>
        ) : (
          <ul className="space-y-2">
            {held.map((h) => (
              <li key={h.id} className="flex items-center gap-3 rounded-lg bg-panel p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink">
                    {h.lines.length} item{h.lines.length > 1 ? 's' : ''} ·{' '}
                    {money(h.total ?? h.lines.reduce((s, l) => s + l.product.price * l.qty, 0))}
                  </div>
                  <div className="text-xs text-mute">{fmtDateTime(h.ts)}</div>
                </div>
                <button
                  className="btn-cta btn-xs"
                  onClick={() => {
                    recallTicket(h);
                    toast.success('Ticket recalled');
                  }}
                >
                  Recall
                </button>
                <button
                  className="btn-ghost btn-xs text-warn"
                  onClick={() => persistHeld(held.filter((x) => x.id !== h.id))}
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal open={!!receiptOrder} onClose={() => setReceiptOrder(null)} title="Receipt">
        {receiptOrder && (
          <>
            <Receipt order={receiptOrder} />
            <div className="modal-action print-hidden">
              <button className="btn-ghost text-ink border border-line hover:bg-panel hover:text-ink" onClick={() => window.print()}>
                <Printer className="mr-1 inline h-4 w-4" aria-hidden="true" /> Print
              </button>
              <button className="btn-cta" onClick={() => setReceiptOrder(null)}>
                New sale
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Receipt strip — signature: live transaction, thermal paper aesthetic ── */}
      <div className="receipt-strip">
        <div className="strip-divider" />
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-2 text-xs text-mute">
            <span className="font-bold text-ink">Sale in progress</span>
            <span className="strip-items">{cart.length} item{cart.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <span className="strip-total">{money(total)}</span>
        <div className="strip-time">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between">
      <span className="text-mute">{label}</span>
      <span className="font-data text-ink">{value}</span>
    </div>
  );
}

function WeightPrompt({ product, money, onClose, onConfirm }) {
  const [qty, setQty] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (product) {
      setQty('');
      setError('');
    }
  }, [product]);

  if (!product) return null;
  const num = Math.round((Number(qty) || 0) * 1000) / 1000;
  const label = product.soldBy === 'weight' ? 'Weight' : 'Length';

  return (
    <Modal open={!!product} onClose={onClose} title={`${product.name} · ${money(product.price)} / ${product.unitLabel || 'unit'}`}>
      <div className="space-y-3">
        <Field label={`${label} (${product.unitLabel || 'units'})`}>
          <input
            type="number"
            min="0"
            step="0.001"
            max={Number(product.stock)}
            className="input-field input-lg w-full text-right text-xl font-bold font-data text-ink"
            value={qty}
            onChange={(e) => {
              setQty(e.target.value);
              setError('');
            }}
            autoFocus
          />
        </Field>
        {num > Number(product.stock) && (
          <p className="text-sm text-warn">Only {Number(product.stock)} {product.unitLabel || ''} in stock.</p>
        )}
        <button
          className={`btn-cta btn-block ${!qty ? 'opacity-50 cursor-not-allowed' : ''}`}
          disabled={!(num > 0) || num > Number(product.stock) + 1e-9}
          onClick={() => onConfirm(num)}
        >
          Add · {money(product.price * num)}
        </button>
      </div>
    </Modal>
  );
}

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'card_terminal', label: 'Terminal', icon: Monitor },
  { value: 'mobile', label: 'Mobile', icon: Smartphone },
  { value: 'gcash', label: 'GCash', icon: Send },
  { value: 'maya', label: 'Maya', icon: CircleDot },
  { value: 'qr_ph', label: 'QR Ph', icon: QrCode },
  { value: 'instapay', label: 'InstaPay', icon: Landmark },
  { value: 'pesonet', label: 'PESONet', icon: Landmark },
  { value: 'gift_card', label: 'Gift card', icon: Ticket },
];

let lineSeq = 0;
const defaultTenderLine = (method = 'cash') => ({ key: ++lineSeq, method, amount: '', reference: '' });

function PaymentModal({ open, onClose, total, cart, discount, discountType, beneficiaryName, beneficiaryIdNumber, beneficiaryIdType, onPaid, onQueued }) {
  const { tenant } = useAuth();
  const toast = useToast();
  const money = makeMoney(tenant?.currency);
  const defaultMethod = tenant?.defaultPaymentMethod ?? 'cash';
  const tipsEnabled = tenant?.tipsEnabled ?? false;
  const tipSuggestions = (tenant?.tipSuggestions ?? '10,15,20').split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
  const [lines, setLines] = useState([defaultTenderLine(defaultMethod)]);
  const [tip, setTip] = useState('0');
  const [busy, setBusy] = useState(false);
  const [idemKey, setIdemKey] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [redeemPoints, setRedeemPoints] = useState('');
  const customer = customers.find((c) => c.id === customerId) ?? null;

  useEffect(() => {
    if (open) {
      setLines([defaultTenderLine(defaultMethod)]);
      setTip('0');
      setIdemKey(crypto.randomUUID());
      setCustomerId('');
      setCouponCode('');
      setRedeemPoints('');
      api('/customers').then(setCustomers).catch(() => {});
    }
  }, [open, total]);

  const tipNum = Math.max(Number(tip) || 0, 0);
  const grand = Math.max(total + tipNum, 0);
  const paidNum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const remaining = grand - paidNum;
  const change = paidNum - grand;
  const hasCash = lines.some((l) => l.method === 'cash');

  const quickAmounts = useMemo(
    () =>
      [...new Set([grand, Math.ceil(grand / 5) * 5, Math.ceil(grand / 10) * 10, Math.ceil(grand / 20) * 20])],
    [grand]
  );

  function updateLine(key, patch) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function fillRemaining(key) {
    updateLine(key, { amount: Math.max(remaining, 0).toFixed(2) });
  }

  function fillQuick(amt) {
    const target = lines.find((l) => l.method === 'cash');
    if (target) updateLine(target.key, { amount: amt.toFixed(2) });
  }

  const linesValid =
    lines.length > 0 &&
    lines.every(
      (l) =>
        Number(l.amount) > 0 &&
        (l.method !== 'gift_card' || String(l.reference).trim() !== '')
    );
  const customerMissing = (tenant?.requireCustomer ?? false) && !customerId;
  const canComplete = linesValid && !customerMissing && remaining <= 0 && (change <= 0 || hasCash);
  const canLayaway = linesValid && paidNum > 0 && remaining > 0;

  async function submit(fulfill) {
    setBusy(true);
    const body = {
      items: cart.map((l) => ({ productId: l.product.id, quantity: l.qty })),
      discount,
      discountType,
      beneficiaryName: beneficiaryName || null,
      beneficiaryIdNumber: beneficiaryIdNumber || null,
      beneficiaryIdType: beneficiaryIdNumber ? beneficiaryIdType : null,
      tip: tipNum,
      fulfill,
      locationId: getLocationId(),
      customerId: customerId || null,
      couponCode: couponCode.trim() || null,
      redeemPoints: Math.floor(Number(redeemPoints) || 0),
      payments: lines.map((l) => ({
        method: l.method,
        amount: Number(Number(l.amount).toFixed(2)),
        reference: String(l.reference).trim() || null,
      })),
      idempotencyKey: idemKey,
    };
    try {
      const result = await api('/orders', { method: 'POST', body });
      if (fulfill === 'layaway') {
        onQueued();
        toast.success(`Layaway #${result.order.orderNo} saved`);
      } else {
        onPaid(result.order);
      }
    } catch (err) {
      const unreachable = !err.status || err.status >= 500 || err.status === 429;
      if (unreachable && idemKey && fulfill === 'now') {
        try {
          await enqueueSale(body, { total: grand });
          onQueued();
          flushQueue().catch(() => {});
          return;
        } catch (queueErr) {
          toast.error(`Could not save offline: ${queueErr.message}`);
        }
      }
      const detail = Array.isArray(err.details) && err.details.length ? err.details[0].message : err.message;
      toast.error(detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Collect payment · ${money(grand)}`} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field label={customerMissing ? 'Customer · required' : 'Customer'}>
            <select
              className={`select-field input-sm w-full text-ink ${customerMissing ? 'border-warn' : ''}`}
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                if (!e.target.value) setRedeemPoints('');
              }}
            >
              <option value="">Walk-in</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.loyaltyPoints > 0 ? ` · ${c.loyaltyPoints} pts` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Coupon code">
            <input
              className="input-field input-sm w-full font-data text-ink uppercase"
              placeholder="Optional"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
            />
          </Field>
          <Field
            label="Redeem points"
            hint={
              customer && customer.loyaltyPoints > 0
                ? `${customer.loyaltyPoints} available · worth ${money((customer.loyaltyPoints * (tenant?.loyaltyPointCents ?? 1)) / 100)}`
                : customer
                  ? 'No points yet'
                  : 'Pick a customer first'
            }
          >
            <input
              type="number"
              min="0"
              max={customer?.loyaltyPoints ?? 0}
              className="input-field input-sm w-full text-ink"
              placeholder="0"
              disabled={!customerId || !customer?.loyaltyPoints}
              value={redeemPoints}
              onChange={(e) =>
                setRedeemPoints(
                  String(Math.min(Math.max(Math.floor(Number(e.target.value)) || 0, 0), customer?.loyaltyPoints ?? 0))
                )
              }
            />
          </Field>
        </div>

        {tipsEnabled && (
          <div>
            <span className="mb-1 block text-xs text-mute">Tip</span>
            <div className="flex flex-wrap items-center gap-2">
              {[0, ...tipSuggestions].map((pct) => {
                const pctAmount = (total * pct) / 100;
                const active = Math.abs(tipNum - pctAmount) < 0.005;
                return (
                  <button
                    key={pct}
                    type="button"
                    className={`btn-ghost btn-xs text-ink border border-line hover:bg-panel ${active ? 'bg-accent text-accent border-accent' : ''}`}
                    onClick={() => setTip(pctAmount.toFixed(2))}
                  >
                    {pct === 0 ? 'No tip' : `${pct}%`}
                  </button>
                );
              })}
              <input
                type="number"
                step="0.01"
                min="0"
                className="input-field input-sm w-28 text-right text-ink"
                placeholder="Custom"
                value={tip}
                onChange={(e) => setTip(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <span className="block text-xs font-medium text-mute">Tender</span>
          {lines.map((l, idx) => (
            <div key={l.key} className="flex flex-wrap items-center gap-2">
              <select
                className="select-field input-sm w-36 text-ink"
                value={l.method}
                onChange={(e) => updateLine(l.key, { method: e.target.value })}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  className="input-field input-sm w-24 text-right text-ink"
                  value={l.amount}
                  onChange={(e) => updateLine(l.key, { amount: e.target.value })}
                />
                <button
                  type="button"
                  className="btn-ghost btn-xs"
                  title="Fill exact remainder"
                  onClick={() => fillRemaining(l.key)}
                >
                  =
                </button>
              </div>
              {['card', 'card_terminal', 'mobile', 'gift_card', 'gcash', 'maya', 'qr_ph', 'instapay', 'pesonet'].includes(l.method) && (
                <input
                  className="input-field input-sm w-40 text-ink"
                  placeholder={l.method === 'gift_card' ? 'Gift card code' : 'Reference'}
                  value={l.reference}
                  onChange={(e) => updateLine(l.key, { reference: e.target.value })}
                />
              )}
              {idx === 0 && lines[0].method === 'cash' && (
                <>
                  {quickAmounts.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      className="btn-outline btn-xs text-ink border border-line hover:bg-panel hover:text-accent"
                      onClick={() => fillQuick(amt)}
                    >
                      {money(amt)}
                    </button>
                  ))}
                </>
              )}
              {lines.length > 1 && (
                <button
                  type="button"
                  className="btn-ghost btn-xs text-warn"
                  aria-label="Remove payment line"
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          {lines.length < 5 && (
            <button
              type="button"
              className="btn-ghost btn-xs text-mute hover:bg-panel hover:text-ink"
              onClick={() => setLines((ls) => [...ls, defaultTenderLine(defaultMethod)])}
            >
              + Split across another payment
            </button>
          )}
        </div>

        <div className="space-y-1 rounded-lg bg-panel p-3 text-sm border border-line">
          <Row label={`Items & tax`} value={money(total)} />
          {tipNum > 0 && <Row label="Tip" value={money(tipNum)} />}
          <div className="flex justify-between border-t border-line pt-1 font-bold text-ink">
            <span>Total due</span>
            <span className="font-data">{money(grand)}</span>
          </div>
          <Row label="Paid so far" value={money(Math.min(paidNum, grand))} />
          {remaining > 0 ? (
            <div className="flex justify-between font-semibold text-warn font-data">
              <span>Still owed</span>
              <span>{money(remaining)}</span>
            </div>
          ) : change > 0 ? (
            <div className="flex justify-between font-semibold text-accent font-data">
              <span>Change due</span>
              <span>{money(change)}</span>
            </div>
          ) : null}
        </div>

        <div className="modal-action">
          <button type="button" className="btn-ghost text-mute hover:bg-panel hover:text-ink" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn-outline text-warn border-warn hover:bg-warn-dim ${busy ? 'opacity-50 cursor-not-allowed' : ''}`}
            disabled={!canLayaway || busy}
            onClick={() => submit('layaway')}
          >
            Layaway · {money(paidNum)} down
          </button>
          <button
            className={`btn-cta ${busy ? 'opacity-50 cursor-not-allowed' : ''}`}
            disabled={!canComplete || busy}
            onClick={() => submit('now')}
          >
            Complete sale · {money(grand)}
          </button>
        </div>
      </div>
    </Modal>
  );
}

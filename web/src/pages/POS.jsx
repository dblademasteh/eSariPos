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

const EMOJI_FALLBACK = '📦';

export default function POS() {
  const { tenant, user, hasPerm } = useAuth();
  const toast = useToast();
  const money = makeMoney(tenant?.currency);

  const [products, setProducts] = useState(null);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState('');
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
        total: Math.round((total) * 100) / 100,
        lines: cart.map((l) => ({ product: { ...l.product }, qty: l.qty })),
      },
    ]);
    setCart([]);
    setDiscount('');
    toast.info('Ticket parked');
  }

  function recallTicket(ticket) {
    setCart(ticket.lines);
    setDiscount(ticket.discount ?? '');
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
      ? products // search reaches into variant children too
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
    setCart((c) => {
      const existing = c.find((l) => l.product.id === product.id);
      if (existing) {
        if (existing.qty + qty > product.stock + eps) {
          toast.error(`Only ${Number(product.stock)} × ${product.name} in stock`);
          return c;
        }
        return c.map((l) => (l.product.id === product.id ? { ...l, qty: Math.round((l.qty + qty) * 1000) / 1000 } : l));
      }
      if (qty > product.stock + eps) {
        toast.error(`Only ${Number(product.stock)} × ${product.name} in stock`);
        return c;
      }
      return [...c, { product, qty }];
    });
  }

  function setQty(productId, qty) {
    setCart((c) =>
      qty <= 0
        ? c.filter((l) => l.product.id !== productId)
        : c.map((l) =>
            l.product.id === productId ? { ...l, qty: Math.min(qty, Number(l.product.stock)) } : l
          )
    );
  }

  const subtotal = cart.reduce((s, l) => s + l.product.price * l.qty, 0);
  const discountNum = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const taxRate = Number(tenant?.taxRate ?? 0);
  const tax = Math.round(((subtotal - discountNum) * taxRate * 100) / 100) / 100;
  const total = Math.max(subtotal - discountNum + tax, 0);

  async function handlePaid(order) {
    setPaymentOpen(false);
    setCart([]);
    setDiscount('');
    setReceiptOrder(order);
    toast.success(`Sale #${order.orderNo} complete`);
    setProducts((ps) => ps.map((p) => {
      const line = order.items.find((i) => i.productId === p.id);
      return line ? { ...p, stock: Math.max(p.stock - line.quantity, 0) } : p;
    }));
    flushQueue().catch(() => {});
    // Kick the cash drawer when cash crossed the counter (best-effort).
    if ((order.payments ?? []).some((p) => p.method === 'cash')) {
      kickCashDrawer().catch(() => {});
    }
  }

  function handleQueued() {
    setPaymentOpen(false);
    setCart([]);
    setDiscount('');
    toast.info('Sale saved offline — it will sync automatically');
  }

  // Live customer-facing display over BroadcastChannel.
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
            className="input input-md w-full max-w-xs"
            placeholder="Search or scan…  ( / )"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && visible.length > 0) {
                handlePick(visible[0]);
                setSearch('');
              }
            }}
          />
          <div className="join">
            <button
              className={`btn btn-sm join-item ${activeCategory === '' ? 'btn-primary' : ''}`}
              onClick={() => setActiveCategory('')}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                className={`btn btn-sm join-item ${activeCategory === c.id ? 'btn-primary' : ''}`}
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
            <EmptyState icon="🔍" title="No products match" subtitle="Try another search or category." />
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
                    className={`card relative border border-base-300 bg-base-100 text-left shadow-sm transition hover:border-primary/50 hover:shadow ${
                      out ? 'opacity-40' : ''
                    }`}
                  >
                    <div className="card-body items-center gap-1 p-3 text-center">
                      {(out || low) && (
                        <span className={`badge badge-xs absolute right-2 top-2 ${out ? 'badge-error' : 'badge-warning'}`}>
                          {out ? 'Out' : `${Number(p.stock)} left`}
                        </span>
                      )}
                      {inCart > 0 && (
                        <span className="badge badge-primary badge-xs absolute left-2 top-2">{inCart}</span>
                      )}
                      <span className="text-4xl">{p.emoji || EMOJI_FALLBACK}</span>
                      <span className="line-clamp-2 min-h-8 text-sm font-medium leading-4">{p.name}</span>
                      {p.variantLabel && <span className="text-[10px] uppercase opacity-50">{p.variantLabel}</span>}
                      <span className="text-sm font-bold text-primary">
                        {money(p.price)}{p.unitLabel ? ` / ${p.unitLabel}` : ''}
                      </span>
                      {p.hasChildren && <span className="text-[10px] opacity-40">tap to pick variant</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <aside className="card order-first h-fit bg-base-100 shadow lg:order-none lg:sticky lg:top-0">
        <div className="card-body gap-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">Current sale</h2>
            <div className="flex items-center gap-1">
              {held.length > 0 && (
                <button className="btn btn-ghost btn-xs" onClick={() => setHeldOpen(true)}>
                  🎟️ {held.length}
                </button>
              )}
              {cart.length > 0 && (
                <>
                  <button className="btn btn-ghost btn-xs" onClick={holdTicket} title="Park this ticket">
                    Hold
                  </button>
                  <button className="btn btn-ghost btn-xs text-error" onClick={() => setCart([])}>
                    Clear
                  </button>
                </>
              )}
              <CashDrawer />
            </div>
          </div>

          {cart.length === 0 ? (
            <p className="py-8 text-center text-sm opacity-50">Tap products to add them.</p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {cart.map((l) => (
                <li key={l.product.id} className="flex items-center gap-2 rounded-lg bg-base-200 p-2">
                  <span className="text-xl">{l.product.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {l.product.name}
                      {l.product.variantLabel && <span className="ml-1 opacity-60">· {l.product.variantLabel}</span>}
                    </div>
                    <div className="text-xs opacity-60">{money(l.product.price)} ea</div>
                  </div>
                  {l.product.soldBy !== 'unit' ? (
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      max={l.product.stock}
                      className="input input-xs w-20 text-right font-mono"
                      value={l.qty}
                      onChange={(e) => {
                        const v = Math.min(Math.max(Number(e.target.value) || 0, 0), l.product.stock);
                        setQty(l.product.id, Math.round(v * 1000) / 1000);
                      }}
                    />
                  ) : (
                    <div className="join">
                      <button aria-label="Decrease quantity" className="btn btn-sm join-item min-h-11 min-w-11 px-0" onClick={() => setQty(l.product.id, l.qty - 1)}>−</button>
                      <span aria-live="polite" className="btn btn-sm join-item pointer-events-none min-h-11 w-11 px-0 font-mono">{l.qty}</span>
                      <button
                        aria-label="Increase quantity"
                        className="btn btn-sm join-item min-h-11 min-w-11 px-0"
                        onClick={() => setQty(l.product.id, l.qty + 1)}
                        disabled={l.qty >= l.product.stock}
                      >
                        +
                      </button>
                    </div>
                  )}
                  <span className="w-16 text-right text-sm font-semibold">{money(l.product.price * l.qty)}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="form-control">
            <label className="mb-1 flex items-center justify-between text-sm">
              <span className="opacity-70">Discount ($)</span>
              {!hasPerm('discounts') && <span className="badge badge-ghost badge-xs">no permission</span>}
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              className={`input input-sm w-full ${hasPerm('discounts') ? '' : 'input-disabled'}`}
              placeholder={hasPerm('discounts') ? '0.00' : 'Not allowed'}
              value={hasPerm('discounts') ? discount : ''}
              disabled={!hasPerm('discounts')}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>

          <div className="space-y-1 border-t border-base-300 pt-3 text-sm">
            <Row label="Subtotal" value={money(subtotal)} />
            {discountNum > 0 && <Row label="Discount" value={`-${money(discountNum)}`} />}
            <Row label={`Tax (${taxRate}%)`} value={money(tax)} />
            <div className="flex justify-between pt-1 text-lg font-bold">
              <span>Total</span>
              <span>{money(total)}</span>
            </div>
          </div>

          <button
            className="btn btn-primary btn-block"
            disabled={cart.length === 0 || total <= 0}
            onClick={() => setPaymentOpen(true)}
          >
            Charge {money(total)}
          </button>
          <p className="text-center text-xs opacity-40">
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
                    className={`btn btn-block justify-between ${v.stock <= 0 ? 'btn-disabled' : ''}`}
                    disabled={v.stock <= 0}
                    onClick={() => {
                      setVariantParent(null);
                      handlePick(v);
                    }}
                  >
                    <span>{v.emoji} {v.variantLabel || v.name}</span>
                    <span className="font-bold">{money(v.price)}</span>
                  </button>
                </li>
              ))}
            {products.filter((p) => p.parentId === variantParent.id && p.isActive).length === 0 && (
              <p className="text-center text-sm opacity-60">No active variants yet.</p>
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
        onPaid={handlePaid}
        onQueued={handleQueued}
      />

      <Modal open={heldOpen} onClose={() => setHeldOpen(false)} title={`Held tickets · ${held.length}`}>
        {held.length === 0 ? (
          <p className="py-4 text-center text-sm opacity-60">Nothing parked.</p>
        ) : (
          <ul className="space-y-2">
            {held.map((h) => (
              <li key={h.id} className="flex items-center gap-3 rounded-lg bg-base-200 p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {h.lines.length} item{h.lines.length > 1 ? 's' : ''} ·{' '}
                    {money(h.total ?? h.lines.reduce((s, l) => s + l.product.price * l.qty, 0))}
                  </div>
                  <div className="text-xs opacity-60">{fmtDateTime(h.ts)}</div>
                </div>
                <button
                  className="btn btn-primary btn-xs"
                  onClick={() => {
                    recallTicket(h);
                    toast.success('Ticket recalled');
                  }}
                >
                  Recall
                </button>
                <button
                  className="btn btn-ghost btn-xs text-error"
                  onClick={() => persistHeld(held.filter((x) => x.id !== h.id))}
                >
                  ✕
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
            <div className="modal-action print:hidden">
              <button className="btn" onClick={() => window.print()}>
                🖨️ Print
              </button>
              <button className="btn btn-primary" onClick={() => setReceiptOrder(null)}>
                New sale
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between">
      <span className="opacity-60">{label}</span>
      <span>{value}</span>
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
            className="input input-lg w-full text-right text-xl font-bold"
            value={qty}
            onChange={(e) => {
              setQty(e.target.value);
              setError('');
            }}
            autoFocus
          />
        </Field>
        {num > Number(product.stock) && (
          <p className="text-sm text-error">Only {Number(product.stock)} {product.unitLabel || ''} in stock.</p>
        )}
        <button
          className={`btn btn-primary btn-block ${!qty ? 'btn-disabled' : ''}`}
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
  { value: 'cash', label: '💵 Cash' },
  { value: 'card', label: '💳 Card' },
  { value: 'card_terminal', label: '🖥️ Terminal' },
  { value: 'mobile', label: '📱 Mobile' },
  { value: 'gift_card', label: '🎟️ Gift card' },
];

let lineSeq = 0;
const newTenderLine = () => ({ key: ++lineSeq, method: 'cash', amount: '', reference: '' });

function PaymentModal({ open, onClose, total, cart, discount, onPaid, onQueued }) {
  const { tenant } = useAuth();
  const toast = useToast();
  const money = makeMoney(tenant?.currency);
  const [lines, setLines] = useState([newTenderLine()]);
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
      setLines([newTenderLine()]);
      setTip('0');
      setIdemKey(crypto.randomUUID());
      setCustomerId('');
      setCouponCode('');
      setRedeemPoints('');
      // One key per payment session: retries and offline replays reuse it,
      // so the server can never double-charge this sale.
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
  const canComplete = linesValid && remaining <= 0 && (change <= 0 || hasCash);
  const canLayaway = linesValid && paidNum > 0 && remaining > 0;

  async function submit(fulfill) {
    setBusy(true);
    const body = {
      items: cart.map((l) => ({ productId: l.product.id, quantity: l.qty })),
      discount,
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
          <Field label="Customer">
            <select
              className="select select-sm w-full"
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
              className="input input-sm w-full font-mono uppercase"
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
              className="input input-sm w-full"
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

        <div>
          <span className="mb-1 block text-sm opacity-70">Tip</span>
          <div className="flex flex-wrap items-center gap-2">
            {[0, 5, 10, 15].map((pct) => {
              const pctAmount = (total * pct) / 100;
              const active = Math.abs(tipNum - pctAmount) < 0.005;
              return (
                <button
                  key={pct}
                  type="button"
                  className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline'}`}
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
              className="input input-sm w-28 text-right"
              placeholder="Custom"
              value={tip}
              onChange={(e) => setTip(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <span className="block text-sm font-medium opacity-80">Tender</span>
          {lines.map((l, idx) => (
            <div key={l.key} className="flex flex-wrap items-center gap-2">
              <select
                className="select select-sm w-36"
                value={l.method}
                onChange={(e) => updateLine(l.key, { method: e.target.value })}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <div className="join">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  className="input input-sm join-item w-24 text-right"
                  value={l.amount}
                  onChange={(e) => updateLine(l.key, { amount: e.target.value })}
                />
                <button
                  type="button"
                  className="btn btn-sm join-item"
                  title="Fill exact remainder"
                  onClick={() => fillRemaining(l.key)}
                >
                  =
                </button>
              </div>
              {['card', 'card_terminal', 'mobile', 'gift_card'].includes(l.method) && (
                <input
                  className="input input-sm w-40"
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
                      className="btn btn-outline btn-xs"
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
                  className="btn btn-ghost btn-sm text-error"
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {lines.length < 5 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setLines((ls) => [...ls, newTenderLine()])}
            >
              + Split across another payment
            </button>
          )}
        </div>

        <div className="space-y-1 rounded-xl bg-base-200 p-3 text-sm">
          <Row label={`Items & tax`} value={money(total)} />
          {tipNum > 0 && <Row label="Tip" value={money(tipNum)} />}
          <div className="flex justify-between border-t border-base-300 pt-1 font-bold">
            <span>Total due</span>
            <span>{money(grand)}</span>
          </div>
          <Row label="Paid so far" value={money(Math.min(paidNum, grand))} />
          {remaining > 0 ? (
            <div className="flex justify-between font-semibold text-error">
              <span>Still owed</span>
              <span>{money(remaining)}</span>
            </div>
          ) : change > 0 ? (
            <div className="flex justify-between font-semibold text-success">
              <span>Change due</span>
              <span>{money(change)}</span>
            </div>
          ) : null}
        </div>

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${canLayaway ? 'btn-outline' : 'btn-disabled'} ${busy ? 'loading' : ''}`}
            disabled={!canLayaway || busy}
            onClick={() => submit('layaway')}
          >
            Layaway · {money(paidNum)} down
          </button>
          <button
            className={`btn btn-primary ${busy ? 'loading' : ''}`}
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

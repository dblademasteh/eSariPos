import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { dayRange, fmtDateTime, makeMoney, todayStr } from '../lib/format.js';
import { downloadCsv } from '../lib/export.js';
import { useAuth } from '../state/AuthContext.jsx';
import { EmptyState, Field, Modal, Spinner, useToast } from '../components/ui.jsx';
import Receipt from '../components/Receipt.jsx';

const STATUS_BADGES = {
  completed: { cls: 'badge-success', label: 'Completed' },
  partially_refunded: { cls: 'badge-warning', label: 'Partly refunded' },
  refunded: { cls: 'badge-error', label: 'Refunded' },
  layaway: { cls: 'badge-warning', label: 'Layaway' },
  cancelled: { cls: 'badge-ghost', label: 'Cancelled' },
};

function StatusBadge({ status }) {
  const s = STATUS_BADGES[status] ?? { cls: 'badge-ghost', label: status };
  return <span className={`badge badge-sm ${s.cls}`}>{s.label}</span>;
}

export default function Orders() {
  const { tenant, can, hasPerm } = useAuth();
  const toast = useToast();
  const money = makeMoney(tenant?.currency);
  const canRefund = hasPerm('refunds');
  const manage = can(2);

  const [orders, setOrders] = useState(null);
  const [date, setDate] = useState(todayStr());
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState(null);
  const [refunding, setRefunding] = useState(null);
  const [settling, setSettling] = useState(null);

  async function load() {
    try {
      const { from, to } = dayRange(date);
      const list = await api('/orders', { query: { from, to, status } });
      setOrders(list);
    } catch (err) {
      toast.error(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [date, status]);

  async function openDetail(id) {
    try {
      setSelected(await api(`/orders/${id}`));
    } catch (err) {
      toast.error(err.message);
    }
  }

  function refresh(updated) {
    if (updated) setSelected(updated);
    load();
  }

  const dayTotal = (orders ?? [])
    .filter((o) => o.status === 'completed' || o.status === 'partially_refunded')
    .reduce((s, o) => s + o.total, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-xl font-bold">Orders</h1>
          <p className="text-sm opacity-60">
            {orders ? `${orders.length} orders · ${money(dayTotal)} sold` : ' '}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input type="date" className="input input-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          <select className="select select-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="completed">Completed</option>
            <option value="partially_refunded">Partly refunded</option>
            <option value="refunded">Refunded</option>
            <option value="layaway">Layaway</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {orders && orders.length > 0 && (
            <button
              className="btn btn-outline btn-sm"
              onClick={() =>
                downloadCsv(`orders-${date}`, [
                  { key: 'orderNo', label: 'Receipt #' },
                  { key: 'time', label: 'Time', value: (o) => new Date(o.createdAt).toLocaleString() },
                  { key: 'status', label: 'Status' },
                  { key: 'itemCount', label: 'Lines' },
                  { key: 'customer', label: 'Customer', value: (o) => o.customerName ?? '' },
                  { key: 'total', label: 'Total' },
                ], orders.map((o) => ({ ...o, time: o.createdAt })))
              }
            >
              ⬇ CSV
            </button>
          )}
        </div>
      </div>

      {!orders ? (
        <Spinner />
      ) : orders.length === 0 ? (
        <EmptyState icon="🧾" title="No orders on this date" />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-base-100 shadow">
          <table className="table">
            <thead>
              <tr>
                <th>Receipt #</th>
                <th>Time</th>
                <th>Items</th>
                <th>Paid via</th>
                <th>Customer</th>
                <th className="text-right">Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-base-200" onClick={() => openDetail(o.id)}>
                  <td className="font-mono font-medium">#{o.orderNo}</td>
                  <td>{fmtDateTime(o.createdAt)}</td>
                  <td>{o.itemCount}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {o.methods.map((m) => (
                        <span key={m} className="badge badge-ghost badge-xs capitalize">
                          {m.replace('_', ' ')}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{o.customerName ?? '—'}</td>
                  <td className="text-right font-semibold">{money(o.total)}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? `Order #${selected.orderNo}` : ''}>
        {selected && (
          <>
            <Receipt order={selected} />
            <div className="modal-action print:hidden">
              {canRefund && ['completed', 'partially_refunded'].includes(selected.status) && (
                <button className="btn btn-outline btn-error mr-auto" onClick={() => setRefunding(selected)}>
                  ↩️ Refund…
                </button>
              )}
              {manage && selected.status === 'layaway' && (
                <>
                  <button className="btn btn-primary mr-auto" onClick={() => setSettling(selected)}>
                    💰 Settle balance
                  </button>
                  <button
                    className="btn btn-outline btn-error"
                    onClick={async () => {
                      if (!window.confirm(`Cancel layaway #${selected.orderNo}? Stock returns and the deposit is marked as returned.`)) return;
                      try {
                        const { order } = await api(`/orders/${selected.id}/cancel`, { method: 'POST', body: {} });
                        toast.success(`Layaway #${order.orderNo} cancelled`);
                        refresh(order);
                      } catch (err) {
                        toast.error(err.message);
                      }
                    }}
                  >
                    Cancel layaway
                  </button>
                </>
              )}
              <button className="btn" onClick={() => window.print()}>
                🖨️ Print
              </button>
              <button className="btn btn-primary" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </>
        )}
      </Modal>

      <RefundModal
        open={!!refunding}
        order={refunding}
        money={money}
        onClose={() => setRefunding(null)}
        onDone={(updated) => {
          setRefunding(null);
          refresh(updated);
        }}
      />

      <SettleModal
        open={!!settling}
        order={settling}
        money={money}
        onClose={() => setSettling(null)}
        onDone={(updated) => {
          setSettling(null);
          refresh(updated);
        }}
      />
    </div>
  );
}

function RefundModal({ open, order, money, onClose, onDone }) {
  const toast = useToast();
  const [qtys, setQtys] = useState({});
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && order) {
      setQtys(Object.fromEntries(order.items.map((i) => [i.id, 0])));
      setRestock(true);
    }
  }, [open, order]);

  if (!open || !order) return null;
  const refundable = order.items.filter((i) => i.quantity - i.refundedQty > 0);
  const pickedQty = Object.values(qtys).reduce((s, q) => s + (Number(q) || 0), 0);
  const everythingLeft = refundable.every((i) => i.quantity - i.refundedQty === (qtys[i.id] ?? 0));

  async function send(lines) {
    setBusy(true);
    try {
      const { order: updated, refund } = await api(`/orders/${order.id}/refund`, {
        method: 'POST',
        body: lines ? { lines, restock } : {},
      });
      toast.success(`Refunded ${money(refund.amount)} on #${updated.orderNo}`);
      onDone(updated);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Refund order #${order.orderNo}`} wide>
      <div className="space-y-3">
        {refundable.length === 0 ? (
          <p className="text-sm opacity-60">Nothing left to refund on this order.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {refundable.map((i) => {
                const left = i.quantity - i.refundedQty;
                return (
                  <li key={i.id} className="flex items-center gap-3 rounded-lg bg-base-200 p-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{i.productName}</div>
                      <div className="text-xs opacity-60">
                        {money(i.unitPrice)} · {left} of {i.quantity} refundable
                      </div>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max={left}
                      className="input input-sm w-20 text-right"
                      value={qtys[i.id] ?? 0}
                      onChange={(e) =>
                        setQtys((q) => ({
                          ...q,
                          [i.id]: Math.min(Math.max(Number(e.target.value) || 0, 0), left),
                        }))
                      }
                    />
                  </li>
                );
              })}
            </ul>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="toggle toggle-sm toggle-success"
                checked={restock}
                onChange={(e) => setRestock(e.target.checked)}
              />
              Return items to stock
            </label>
          </>
        )}
        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          {pickedQty > 0 && !everythingLeft && (
            <button className={`btn btn-error ${busy ? 'loading' : ''}`} disabled={busy} onClick={() => send(refundable.map((i) => ({ itemId: i.id, quantity: Number(qtys[i.id]) || 0 })).filter((l) => l.quantity > 0))}>
              Refund {pickedQty} item{pickedQty > 1 ? 's' : ''}
            </button>
          )}
          {refundable.length > 0 && (
            <button className={`btn btn-outline btn-error ${busy ? 'loading' : ''}`} disabled={busy} onClick={() => send(null)}>
              ↩️ Refund entire order
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function SettleModal({ open, order, money, onClose, onDone }) {
  const toast = useToast();
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && order) {
      const balance = Math.max(order.total - (order.amountPaid ?? 0), 0);
      setMethod('cash');
      setAmount(balance.toFixed(2));
      setReference('');
    }
  }, [open, order]);

  if (!open || !order) return null;
  const balance = Math.max(order.total - (order.amountPaid ?? 0), 0);
  const paid = Number(amount) || 0;

  async function settle() {
    setBusy(true);
    try {
      const { order: updated } = await api(`/orders/${order.id}/settle`, {
        method: 'POST',
        body: {
          payments: [
            {
              method,
              amount: Number(paid.toFixed(2)),
              reference: reference.trim() || null,
            },
          ],
        },
      });
      toast.success(`Layaway #${updated.orderNo} settled`);
      onDone(updated);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Settle layaway #${order.orderNo}`}>
      <div className="space-y-3">
        <div className="rounded-xl bg-warning/10 p-3 text-center">
          <div className="text-xs uppercase tracking-wide opacity-60">Balance due</div>
          <div className="text-2xl font-black">{money(balance)}</div>
        </div>
        <Field label="Payment method">
          <select className="select select-md w-full" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">💵 Cash</option>
            <option value="card">💳 Card</option>
            <option value="mobile">📱 Mobile</option>
            <option value="gift_card">🎟️ Gift card</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Amount received">
          <input
            type="number"
            step="0.01"
            min="0"
            className="input input-lg w-full text-right text-xl font-bold"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        {(method === 'card' || method === 'mobile' || method === 'gift_card') && (
          <Field label="Reference" hint={method === 'gift_card' ? 'Gift card code' : 'Auth code, last 4, …'}>
            <input className="input input-md w-full" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        )}
        {paid > balance && method !== 'cash' && (
          <p className="text-sm text-error">Overpayment is only allowed with cash.</p>
        )}
        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button
            className={`btn btn-primary ${busy ? 'loading' : ''}`}
            disabled={paid <= 0 || (paid > balance && method !== 'cash') || busy}
            onClick={settle}
          >
            Complete sale · {money(Math.min(paid, balance))}
          </button>
        </div>
      </div>
    </Modal>
  );
}

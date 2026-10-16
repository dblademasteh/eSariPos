import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { dayRange, fmtDateTime, makeMoney, todayStr } from '../lib/format.js';
import { downloadCsv } from '../lib/export.js';
import { useAuth } from '../state/AuthContext.jsx';
import { EmptyState, Field, Modal, Spinner, useToast } from '../components/ui.jsx';
import Receipt from '../components/Receipt.jsx';
import { Receipt as ReceiptIcon, RotateCcw, Banknote, Printer, Download } from 'lucide-react';

const STATUS_BADGES = {
  completed: { cls: 'bg-accent text-white', label: 'Completed' },
  partially_refunded: { cls: 'bg-warn/10 text-warn border border-warn/20', label: 'Partly refunded' },
  refunded: { cls: 'bg-warn text-white', label: 'Refunded' },
  layaway: { cls: 'bg-warn/10 text-warn border border-warn/20', label: 'Layaway' },
  cancelled: { cls: 'bg-panel text-mute border border-line', label: 'Cancelled' },
};

function StatusBadge({ status }) {
  const s = STATUS_BADGES[status] ?? { cls: 'bg-panel text-mute border border-line', label: status };
  return <span className={`badge-pill badge-sm border rounded-full ${s.cls}`}>{s.label}</span>;
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
      <div className="receipt-head">
        <div className="receipt-meta">
          <span className="font-bold">{tenant?.name}</span>
          <span className="dot" aria-hidden="true"></span>
          <span>{new Date().toLocaleDateString()}</span>
        </div>
        <h1 className="text-xl font-bold">Orders</h1>
        <p className="text-sm text-mute">
          {orders ? `${orders.length} orders · ${money(dayTotal)} sold` : ' '}
        </p>
        <div className="ml-auto flex items-center gap-2 mt-2">
          <input type="date" className="input-field input-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          <select className="select-field input-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="completed">Completed</option>
            <option value="partially_refunded">Partly refunded</option>
            <option value="refunded">Refunded</option>
            <option value="layaway">Layaway</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {orders && orders.length > 0 && (
            <button
              className="btn-outline btn-sm text-ink border-line hover:bg-panel hover:text-ink"
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
              <Download className="mr-1 inline h-4 w-4" /> CSV
            </button>
          )}
        </div>
      </div>

      {!orders ? (
        <Spinner />
      ) : orders.length === 0 ? (
        <EmptyState icon={<ReceiptIcon className="mx-auto h-12 w-12 text-mute" />} title="No orders on this date" />
      ) : (
        <div className="overflow-x-auto card-counter">
          <table className="table-counter">
            <thead>
              <tr>
                <th className="text-ink">Receipt #</th>
                <th className="text-ink">Time</th>
                <th className="text-ink">Items</th>
                <th className="text-ink">Paid via</th>
                <th className="text-ink">Customer</th>
                <th className="text-right text-ink">Total</th>
                <th className="text-ink">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-panel" onClick={() => openDetail(o.id)}>
                  <td className="font-data font-medium text-ink">#{o.orderNo}</td>
                  <td className="text-mute">{fmtDateTime(o.createdAt)}</td>
                  <td className="text-mute">{o.itemCount}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {o.methods.map((m) => (
                        <span key={m} className="badge-pill badge-sm text-mute capitalize">
                          {m.replace('_', ' ')}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="text-mute">{o.customerName ?? '—'}</td>
                  <td className="text-right font-semibold text-ink">{money(o.total)}</td>
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
                <button className="btn-outline text-warn border-warn" onClick={() => setRefunding(selected)}>
                  <RotateCcw className="mr-1 inline h-4 w-4" /> Refund…
                </button>
              )}
              {manage && selected.status === 'layaway' && (
                <>
                  <button className="btn-cta" onClick={() => setSettling(selected)}>
                    <Banknote className="mr-1 inline h-4 w-4" /> Settle balance
                  </button>
                  <button
                    className="btn-outline text-warn border-warn"
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
              <button className="btn-ghost text-ink border-line hover:bg-panel hover:text-ink" onClick={() => window.print()}>
                <Printer className="mr-1 inline h-4 w-4" /> Print
              </button>
              <button className="btn-cta" onClick={() => setSelected(null)}>
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
          <p className="text-sm text-mute">Nothing left to refund on this order.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {refundable.map((i) => {
                const left = i.quantity - i.refundedQty;
                return (
                  <li key={i.id} className="flex items-center gap-3 rounded-lg bg-panel p-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{i.productName}</div>
                      <div className="text-xs text-mute">
                        {money(i.unitPrice)} · {left} of {i.quantity} refundable
                      </div>
                    </div>
                    <input
                      type="number"
                      min="0"
                      max={left}
                      className="input-field input-sm w-20 text-right text-ink"
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
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="toggle-field toggle-sm"
                checked={restock}
                onChange={(e) => setRestock(e.target.checked)}
              />
              Return items to stock
            </label>
          </>
        )}
        <div className="modal-action">
          <button className="btn-ghost text-mute hover:bg-panel hover:text-ink" onClick={onClose}>
            Close
          </button>
          {pickedQty > 0 && !everythingLeft && (
            <button className={`btn-warn text-white ${busy ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={busy} onClick={() => send(refundable.map((i) => ({ itemId: i.id, quantity: Number(qtys[i.id]) || 0 })).filter((l) => l.quantity > 0))}>
              Refund {pickedQty} item{pickedQty > 1 ? 's' : ''}
            </button>
          )}
          {refundable.length > 0 && (
            <button className={`btn-outline text-warn border-warn ${busy ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={busy} onClick={() => send(null)}>
              <RotateCcw className="mr-1 inline h-4 w-4" /> Refund entire order
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
        <div className="rounded-lg bg-warn-dim p-3 text-center border border-warn">
          <div className="text-xs uppercase tracking-wide text-mute">Balance due</div>
          <div className="text-2xl font-black text-ink">{money(balance)}</div>
        </div>
        <Field label="Payment method">
          <select className="select-field input-md w-full text-ink" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="mobile">Mobile</option>
            <option value="gift_card">Gift card</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Amount received">
          <input
            type="number"
            step="0.01"
            min="0"
            className="input-field input-lg w-full text-right text-xl font-bold font-data text-ink"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        {(method === 'card' || method === 'mobile' || method === 'gift_card') && (
          <Field label="Reference" hint={method === 'gift_card' ? 'Gift card code' : 'Auth code, last 4, …'}>
            <input className="input-field input-md w-full text-ink" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        )}
        {paid > balance && method !== 'cash' && (
          <p className="text-sm text-warn">Overpayment is only allowed with cash.</p>
        )}
        <div className="modal-action">
          <button className="btn-ghost text-mute hover:bg-panel hover:text-ink" onClick={onClose}>
            Close
          </button>
          <button
            className={`btn-cta ${busy ? 'opacity-50 cursor-not-allowed' : ''}`}
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

import { makeMoney } from '../lib/format.js';
import { useAuth } from '../state/AuthContext.jsx';

export default function Receipt({ order }) {
  const { user, tenant } = useAuth();
  if (!order) return null;
  const money = makeMoney(tenant?.currency);

  return (
    <div className="print-area rounded-xl bg-base-100 p-4 font-mono text-sm">
      <div className="text-center">
        <div className="text-lg font-bold">{tenant?.name}</div>
        {tenant?.address && <div className="text-xs opacity-70">{tenant.address}</div>}
        {tenant?.phone && <div className="text-xs opacity-70">{tenant.phone}</div>}
      </div>

      <div className="my-3 border-t border-dashed border-base-300 pt-2 text-xs opacity-70">
        <div>Receipt #{order.orderNo}</div>
        <div>{new Date(order.createdAt).toLocaleString()}</div>
        {order.cashierName && <div>Served by {order.cashierName}</div>}
      </div>

      <table className="w-full">
        <tbody>
          {order.items.map((item) => (
            <tr key={item.id} className="align-top">
              <td className="py-0.5 pr-2">{item.quantity}×</td>
              <td className="py-0.5">{item.productName}</td>
              <td className="py-0.5 text-right whitespace-nowrap">{money(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 space-y-0.5 border-t border-dashed border-base-300 pt-2 text-xs">
        <Row label="Subtotal" value={money(order.subtotal)} />
        {order.discount > 0 && <Row label="Discount" value={`-${money(order.discount)}`} />}
        <Row
          label={`Tax (${Number(tenant?.taxRate ?? 0)}%)`}
          value={money(order.taxTotal)}
        />
        {(order.surcharge ?? 0) > 0 && (
          <Row label={`Service charge (${Number(tenant?.surchargePct ?? 0)}%)`} value={money(order.surcharge)} />
        )}
        {(order.tip ?? 0) > 0 && <Row label="Tip" value={money(order.tip)} />}
        {(order.roundingAdjustment ?? 0) !== 0 && (
          <Row label="Cash rounding" value={money(order.roundingAdjustment)} />
        )}
        <div className="flex justify-between border-t border-base-300 pt-1 text-sm font-bold">
          <span>TOTAL</span>
          <span>{money(order.total)}</span>
        </div>
      </div>

      {(order.couponCode || (order.pointsRedeemed ?? 0) > 0) && (
        <div className="mt-1 space-y-0.5 text-xs opacity-70">
          {order.couponCode && <Row label={`Coupon ${order.couponCode}`} value="applied" />}
          {(order.pointsRedeemed ?? 0) > 0 && (
            <Row label="Points redeemed" value={String(order.pointsRedeemed)} />
          )}
        </div>
      )}

      <div className="mt-2 space-y-0.5 text-xs opacity-80">
        {order.payments.map((p, i) => (
          <Row key={i} label={`${capitalize(p.method)}${p.reference ? ` (${p.reference})` : ''}`} value={money(p.amount)} />
        ))}
        {(order.changeDue ?? 0) > 0 && <Row label="Change" value={money(order.changeDue)} />}
      </div>

      {(order.refundedTotal ?? 0) > 0 && (
        <div className="mt-2 text-xs font-bold text-error">Refunded: {money(order.refundedTotal)}</div>
      )}
      {order.status === 'refunded' && (
        <div className="mt-3 text-center font-bold text-error">** REFUNDED **</div>
      )}
      {order.status === 'layaway' && (
        <div className="mt-3 text-center font-bold text-warning">** LAYAWAY - BALANCE DUE **</div>
      )}

      {tenant?.receiptFooter && (
        <div className="mt-4 border-t border-dashed border-base-300 pt-2 text-center text-xs opacity-70">
          {tenant.receiptFooter}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span>{label}</span>
      <span className="whitespace-nowrap">{value}</span>
    </div>
  );
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

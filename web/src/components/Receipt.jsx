import { makeMoney } from '../lib/format.js';
import { useAuth } from '../state/AuthContext.jsx';

export default function Receipt({ order }) {
  const { user, tenant } = useAuth();
  if (!order) return null;
  const money = makeMoney(tenant?.currency);
  const taxRate = Number(tenant?.taxRate ?? 0);
  const isScPwd = order.discountType === 'senior' || order.discountType === 'pwd';
  const vatExclusiveAmount = taxRate > 0
    ? Math.round((order.subtotal - order.discount) * 100 / (100 + taxRate) * 100) / 100
    : order.subtotal - order.discount;

  return (
    <div className="print-area rounded-xl bg-panel p-4 font-data text-sm text-ink">
      <div className="text-center">
        {tenant?.logoUrl && <img src={tenant.logoUrl} alt="Logo" className="mx-auto mb-2 h-12 w-auto object-contain" width="48" height="48" loading="lazy" />}
        {tenant?.receiptHeader && <div className="mb-1 text-xs opacity-70">{tenant.receiptHeader}</div>}
        <div className="text-lg font-bold">{tenant?.name}</div>
        {tenant?.address && <div className="text-xs opacity-70">{tenant.address}</div>}
        {tenant?.phone && <div className="text-xs opacity-70">{tenant.phone}</div>}
        {tenant?.tin && <div className="text-xs opacity-70">TIN: {tenant.tin}</div>}
        {tenant?.birAccreditationNo && <div className="text-xs opacity-70">BIR Acc. No.: {tenant.birAccreditationNo}</div>}
        {tenant?.machineSerialNo && <div className="text-xs opacity-70">Machine SN: {tenant.machineSerialNo}</div>}
      </div>

      <div className="my-3 border-t border-dashed border-line pt-2 text-xs opacity-70">
        <div className="text-center text-sm font-bold text-accent">OFFICIAL RECEIPT</div>
        <div>Receipt #{order.orderNo}</div>
        <div>{new Date(order.createdAt).toLocaleString()}</div>
        {order.cashierName && <div>Served by {order.cashierName}</div>}
      </div>

      <table className="w-full">
        <tbody>
          {order.items.map((item) => (
            <tr key={item.id} className="align-top">
              <td className="py-0.5 pr-2">{item.quantity}×</td>
              <td className="py-0.5">
                <div>{item.productName}</div>
                <div className="text-[10px] opacity-50">@ {money(item.unitPrice)} ea</div>
              </td>
              <td className="py-0.5 text-right whitespace-nowrap">{money(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 space-y-0.5 border-t border-dashed border-line pt-2 text-xs">
        <Row label="Subtotal (VAT Incl.)" value={money(order.subtotal)} />
        {order.discount > 0 && (
          <>
            <Row
              label={isScPwd ? `${order.discountType === 'senior' ? 'Senior Citizen' : 'PWD'} Discount (20%)` : 'Discount'}
              value={`-${money(order.discount)}`}
            />
            {isScPwd && (
              <div className="text-[10px] opacity-50 pl-2">
                {order.beneficiaryName && <div>Name: {order.beneficiaryName}</div>}
                {order.beneficiaryIdNumber && <div>{order.beneficiaryIdType === 'pwd_id' ? 'PWD' : 'Senior'} ID: {order.beneficiaryIdNumber}</div>}
                <div className="font-bold">VAT Exempt on discounted portion</div>
              </div>
            )}
          </>
        )}
        {taxRate > 0 && (
          <>
            <Row label="Amount (VAT Excl.)" value={money(vatExclusiveAmount)} />
            <Row label={`VAT (${taxRate}%)`} value={money(order.taxTotal)} />
          </>
        )}
        {(order.surcharge ?? 0) > 0 && (
          <Row label={`Service charge (${Number(tenant?.surchargePct ?? 0)}%)`} value={money(order.surcharge)} />
        )}
        {(order.tip ?? 0) > 0 && <Row label="Tip" value={money(order.tip)} />}
        {(order.roundingAdjustment ?? 0) !== 0 && (
          <Row label="Cash rounding" value={money(order.roundingAdjustment)} />
        )}
        <div className="flex justify-between border-t border-line pt-1 text-sm font-bold">
          <span>TOTAL</span>
          <span className="font-data">{money(order.total)}</span>
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
        <div className="mt-2 text-xs font-bold text-warn">Refunded: {money(order.refundedTotal)}</div>
      )}
      {order.status === 'refunded' && (
        <div className="mt-3 text-center font-bold text-warn">** REFUNDED **</div>
      )}
      {order.status === 'layaway' && (
        <div className="mt-3 text-center font-bold text-warn">** LAYAWAY - BALANCE DUE **</div>
      )}

      {tenant?.receiptFooter && (
        <div className="mt-4 border-t border-dashed border-line pt-2 text-center text-xs opacity-70">
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
      <span className="whitespace-nowrap font-data">{value}</span>
    </div>
  );
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

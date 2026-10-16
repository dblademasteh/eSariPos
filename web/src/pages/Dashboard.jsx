import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { makeMoney, fmtWeekdayShort, tz } from '../lib/format.js';
import { downloadCsv } from '../lib/export.js';
import { useAuth } from '../state/AuthContext.jsx';
import { Spinner, useToast } from '../components/ui.jsx';
import { TrendingUp, TrendingDown, Download } from 'lucide-react';

const RANGES = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
];

function rangeFor(key) {
  const days = RANGES.find((r) => r.key === key)?.days ?? 7;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString(), days };
}

export default function Dashboard() {
  const { tenant } = useAuth();
  const toast = useToast();
  const money = makeMoney(tenant?.currency);
  const [rangeKey, setRangeKey] = useState('today');
  const [data, setData] = useState(null);
  const [profit, setProfit] = useState([]);
  const [tax, setTax] = useState(null);

  const range = useMemo(() => rangeFor(rangeKey), [rangeKey]);

  useEffect(() => {
    const zone = tz();
    const prior = {
      from: new Date(new Date(range.from).getTime() - range.days * 86_400_000).toISOString(),
      to: range.from,
    };
    Promise.all([
      api('/reports/summary', { query: { tz: zone, ...range } }),
      api('/reports/summary', { query: { tz: zone, ...prior } }),
      api('/reports/daily', { query: { days: Math.max(range.days, 7), tz: zone } }),
      api('/reports/top-products', { query: { days: 30, limit: 5 } }),
      api('/reports/low-stock'),
      api('/reports/profitability', { query: { days: Math.max(range.days, 7), limit: 10 } }),
      api('/reports/tax', { query: { from: range.from, to: range.to } }),
    ])
      .then(([summary, prevSummary, daily, top, lowStock, profitability, taxData]) =>
        setData({ summary, prevSummary, daily, top, lowStock, profitability, tax: taxData })
      )
      .catch((err) => toast.error(err.message));
  }, [rangeKey]);

  useEffect(() => {
    if (data) setProfit(data.profitability);
    if (data) setTax(data.tax);
  }, [data]);

  if (!data || !tax) return <Spinner label="Crunching numbers…" />;

  const maxRevenue = Math.max(...data.daily.map((d) => d.revenue), 1);
  const maxQty = Math.max(...data.top.map((t) => t.qty), 1);

  const delta = (now, before) => {
    const pct = before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null;
    return { diff: now - before, pct };
  };

  return (
    <div className="space-y-6">
      <div className="receipt-head">
        <div className="receipt-meta">
          <span className="font-bold">{tenant?.name}</span>
          <span className="dot" aria-hidden="true"></span>
          <span>{new Date().toLocaleDateString()}</span>
        </div>
        <h1 className="text-xl font-bold">Dashboard</h1>
        <p className="text-sm text-mute">Sales at a glance · compared with the previous period</p>
        <div role="tablist" className="flex gap-1 mt-2">
          {RANGES.map((r) => (
            <button
              key={r.key}
              className={`btn-ghost btn-sm ${rangeKey === r.key ? 'bg-accent text-white' : 'bg-panel text-mute hover:bg-panel hover:text-ink'}`}
              onClick={() => setRangeKey(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat
          title="Net revenue"
          value={money(data.summary.revenue)}
          compare={delta(data.summary.revenue, data.prevSummary.revenue)}
          money={money}
          accent
        />
        <Stat title="Orders" value={data.summary.ordersCount} compare={delta(data.summary.ordersCount, data.prevSummary.ordersCount)} money={money} />
        <Stat title="Avg ticket" value={money(data.summary.avgTicket)} compare={delta(data.summary.avgTicket, data.prevSummary.avgTicket)} money={money} />
        <Stat title="Items sold" value={data.summary.itemsSold} compare={delta(data.summary.itemsSold, data.prevSummary.itemsSold)} money={money} />
      </div>

      <div className="card-counter">
        <div className="card-body">
          <h2 className="text-base font-bold text-ink">Tax summary · selected period</h2>
          {(tax.rates ?? []).map((r) => (
            <div key={r.rate} className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="font-medium text-ink">Rate {r.rate}%</span>
              <span className="text-mute">Taxable {money(r.taxableSales)}</span>
              <span className="text-mute">Discounts -{money(r.discounts)}</span>
              <span className="font-semibold text-accent">Net tax due {money(r.estimatedNetTax)}</span>
            </div>
          ))}
          <p className="text-xs text-mute">Single registered rate today; grouped by rate so extra jurisdictions slot in later.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="card-counter lg:col-span-3">
          <div className="card-body">
            <h2 className="text-base font-bold text-ink">Daily revenue</h2>
            <div className="mt-2 flex h-48 items-end gap-2 overflow-x-auto">
              {data.daily.slice(-Math.max(range.days, 7)).map((d) => (
                <div key={d.day} className="flex h-full min-w-[36px] flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[10px] text-mute">{d.revenue > 0 ? money(d.revenue) : ''}</span>
                  <div
                    className="w-full rounded-t-lg bg-accent/80 transition-colors hover:bg-accent"
                    style={{ height: `${Math.max((d.revenue / maxRevenue) * 100, d.revenue > 0 ? 3 : 1)}%` }}
                    title={`${d.orders} orders`}
                  ></div>
                  <span className="text-xs text-mute">{fmtWeekdayShort(d.day)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card-counter lg:col-span-2">
          <div className="card-body">
            <h2 className="text-base font-bold text-ink">Top sellers (30 days)</h2>
            <ul className="mt-2 space-y-3">
              {data.top.length === 0 && <li className="text-sm text-mute">No sales yet.</li>}
              {data.top.map((p, i) => (
                <li key={p.name}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate">
                      <span className="mr-1 font-semibold text-mute">#{i + 1}</span>
                      {p.name}
                    </span>
                    <span className="whitespace-nowrap font-medium text-ink">{p.qty} sold</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-line">
                    <div className="h-1.5 rounded-full bg-accent" style={{ width: `${(p.qty / maxQty) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="card-counter">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">Product profitability · net of refunds</h2>
            <button
              className="btn-outline btn-sm text-ink hover:text-ink border-line"
              onClick={() =>
                downloadCsv(`profitability-${range.days}d`, [
                  { key: 'name', label: 'Product' },
                  { key: 'qty', label: 'Units sold' },
                  { key: 'revenue', label: 'Revenue' },
                  { key: 'cogs', label: 'Cost of goods' },
                  { key: 'profit', label: 'Profit' },
                  { key: 'marginPct', label: 'Margin %' },
                ], profit)
              }
            >
              <Download className="mr-1 inline h-4 w-4" /> CSV
            </button>
          </div>
          {profit.length === 0 ? (
            <p className="py-4 text-center text-sm text-mute">No sales in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-counter table-sm mt-2">
                <thead>
                  <tr>
                    <th className="text-ink">Product</th>
                    <th className="text-right text-ink">Sold</th>
                    <th className="text-right text-ink">Revenue</th>
                    <th className="text-right text-ink">COGS</th>
                    <th className="text-right text-ink">Profit</th>
                    <th className="text-right text-ink">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {profit.slice(0, 8).map((p) => (
                    <tr key={p.productId}>
                      <td className="text-ink">{p.name}</td>
                      <td className="text-right font-data text-ink">{p.qty}</td>
                      <td className="text-right text-ink">{money(p.revenue)}</td>
                      <td className="text-right text-mute">{money(p.cogs)}</td>
                      <td className={`text-right font-semibold text-ink ${p.profit < 0 ? 'text-warn' : ''}`}>{money(p.profit)}</td>
                      <td className="text-right font-data text-mute">{p.marginPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card-counter">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">Low stock</h2>
            <Link to="/products" className="text-accent hover:underline text-sm">
              Manage products &rarr;
            </Link>
          </div>
          {data.lowStock.length === 0 ? (
            <p className="py-4 text-center text-sm text-mute">All items are in stock.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-counter table-sm mt-2">
                <thead>
                  <tr>
                    <th className="text-ink">Product</th>
                    <th className="text-right text-ink">Stock</th>
                    <th className="text-ink">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lowStock.map((p) => (
                    <tr key={p.id}>
                      <td className="text-ink">{p.name}</td>
                      <td className="text-right font-data text-ink">{Number(p.stock)}</td>
                      <td>
                        {Number(p.stock) === 0 ? (
                          <span className="badge-pill fill-warn badge-sm">Out of stock</span>
                        ) : (
                          <span className="badge-pill warn badge-sm">Running low</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Delta({ compare }) {
  if (!compare) return null;
  const { diff, pct } = compare;
  if (diff === 0) return <span className="text-xs text-mute">= previous</span>;
  const up = diff > 0;
  return (
    <span className={`text-xs font-semibold ${up ? 'text-accent' : 'text-warn'}`}>
      {up ? <TrendingUp className="inline h-4 w-4 text-accent" /> : <TrendingDown className="inline h-4 w-4 text-warn" />} {Math.abs(pct ?? 100)}%
      <span className="ml-1 text-mute">vs prev</span>
    </span>
  );
}

function Stat({ title, value, accent, compare, money }) {
  void money;
  return (
    <div className={`card-counter ${accent ? 'bg-accent text-white' : ''}`}>
      <div className="text-xs text-mute">{title}</div>
      <div className={`text-2xl md:text-3xl font-data ${accent ? 'text-white' : 'text-ink'}`}>{value}</div>
      {compare && (
        <div className={`${accent ? 'text-white/90' : ''}`}>
          <Delta compare={compare} />
        </div>
      )}
    </div>
  );
}

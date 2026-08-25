import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { makeMoney, fmtWeekdayShort, tz } from '../lib/format.js';
import { downloadCsv } from '../lib/export.js';
import { useAuth } from '../state/AuthContext.jsx';
import { Spinner, useToast } from '../components/ui.jsx';
import { PartyPopper, TrendingUp, TrendingDown, Download } from 'lucide-react';

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
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm opacity-60">Sales at a glance · compared with the previous period</p>
        </div>
        <div role="tablist" className="join ml-auto">
          {RANGES.map((r) => (
            <button
              key={r.key}
              className={`btn btn-sm join-item ${rangeKey === r.key ? 'btn-primary' : ''}`}
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

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title text-base">Tax summary · selected period</h2>
          {(tax.rates ?? []).map((r) => (
            <div key={r.rate} className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="font-medium">Rate {r.rate}%</span>
              <span>Taxable {money(r.taxableSales)}</span>
              <span>Discounts -{money(r.discounts)}</span>
              <span className="font-semibold text-primary">Net tax due {money(r.estimatedNetTax)}</span>
            </div>
          ))}
          <p className="text-xs opacity-50">Single registered rate today; grouped by rate so extra jurisdictions slot in later.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="card bg-base-100 shadow lg:col-span-3">
          <div className="card-body">
            <h2 className="card-title text-base">Daily revenue</h2>
            <div className="mt-2 flex h-48 items-end gap-2 overflow-x-auto">
              {data.daily.slice(-Math.max(range.days, 7)).map((d) => (
                <div key={d.day} className="flex h-full min-w-[36px] flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[10px] opacity-60">{d.revenue > 0 ? money(d.revenue) : ''}</span>
                  <div
                    className="w-full rounded-t-lg bg-primary/80 transition-colors hover:bg-primary"
                    style={{ height: `${Math.max((d.revenue / maxRevenue) * 100, d.revenue > 0 ? 3 : 1)}%` }}
                    title={`${d.orders} orders`}
                  ></div>
                  <span className="text-xs opacity-60">{fmtWeekdayShort(d.day)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card bg-base-100 shadow lg:col-span-2">
          <div className="card-body">
            <h2 className="card-title text-base">Top sellers (30 days)</h2>
            <ul className="mt-2 space-y-3">
              {data.top.length === 0 && <li className="text-sm opacity-60">No sales yet.</li>}
              {data.top.map((p, i) => (
                <li key={p.name}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate">
                      <span className="mr-1 font-semibold opacity-40">#{i + 1}</span>
                      {p.name}
                    </span>
                    <span className="whitespace-nowrap font-medium">{p.qty} sold</span>
                  </div>
                  <progress className="progress progress-secondary h-1.5" value={p.qty} max={maxQty}></progress>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h2 className="card-title text-base">Product profitability · net of refunds</h2>
            <button
              className="btn btn-outline btn-sm"
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
            <p className="py-4 text-center text-sm opacity-60">No sales in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm mt-2">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-right">Sold</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right">COGS</th>
                    <th className="text-right">Profit</th>
                    <th className="text-right">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {profit.slice(0, 8).map((p) => (
                    <tr key={p.productId}>
                      <td>{p.name}</td>
                      <td className="text-right font-mono">{p.qty}</td>
                      <td className="text-right">{money(p.revenue)}</td>
                      <td className="text-right opacity-70">{money(p.cogs)}</td>
                      <td className={`text-right font-semibold ${p.profit >= 0 ? '' : 'text-error'}`}>{money(p.profit)}</td>
                      <td className="text-right font-mono">{p.marginPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h2 className="card-title text-base">Low stock</h2>
            <Link to="/products" className="link link-primary link-sm text-sm">
              Manage products -&gt;
            </Link>
          </div>
          {data.lowStock.length === 0 ? (
            <p className="py-4 text-center text-sm opacity-60">Everything is well stocked <PartyPopper className="inline h-5 w-5 text-primary" /></p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm mt-2">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-right">Stock</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lowStock.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.name}
                      </td>
                      <td className="text-right font-mono">{Number(p.stock)}</td>
                      <td>
                        {Number(p.stock) === 0 ? (
                          <span className="badge badge-error badge-sm text-error-content">Out of stock</span>
                        ) : (
                          <span className="badge badge-warning badge-sm text-warning-content">Running low</span>
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
  if (diff === 0) return <span className="text-xs opacity-50">= previous</span>;
  const up = diff > 0;
  return (
    <span className={`text-xs font-semibold ${up ? 'text-success' : 'text-error'}`}>
      {up ? <TrendingUp className="inline h-4 w-4 text-success" /> : <TrendingDown className="inline h-4 w-4 text-error" />} {Math.abs(pct ?? 100)}%
      <span className="ml-1 opacity-60">vs prev</span>
    </span>
  );
}

function Stat({ title, value, accent, compare, money }) {
  void money;
  return (
    <div className={`stat rounded-xl shadow ${accent ? 'bg-primary text-primary-content' : 'bg-base-100'}`}>
      <div className="stat-title text-xs">{title}</div>
      <div className="stat-value text-2xl md:text-3xl">{value}</div>
      {compare && (
        <div className={`${accent ? 'text-primary-content/80' : ''}`}>
          <Delta compare={compare} />
        </div>
      )}
    </div>
  );
}

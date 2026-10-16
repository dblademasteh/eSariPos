import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { fmtDateTime } from '../lib/format.js';
import { downloadCsv } from '../lib/export.js';
import { EmptyState, Spinner } from '../components/ui.jsx';
import { Download, ScrollText } from 'lucide-react';

export default function Audit() {
  const [entries, setEntries] = useState(null);
  const [actions, setActions] = useState([]);
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');

  async function load() {
    try {
      const data = await api('/audit', { query: { action, limit: 200 } });
      setEntries(data.entries);
      setActions(data.actions);
    } catch {
      setEntries([]);
    }
  }

  useEffect(() => {
    load();
  }, [action]);

  const visible = (entries ?? []).filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (e.staffName ?? '').toLowerCase().includes(q) ||
      (e.entity ?? '').toLowerCase().includes(q) ||
      JSON.stringify(e.meta).toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div className="receipt-head">
        <div className="receipt-meta">
          <span className="font-bold">eSariPOS</span>
          <span className="dot" aria-hidden="true"></span>
          <span>{new Date().toLocaleDateString()}</span>
        </div>
        <h1 className="text-xl font-bold">Audit log</h1>
        <p className="text-sm opacity-60">Admin and user actions across the business</p>
        <div className="ml-auto flex items-center gap-2 mt-2">
          <select className="select-field input-sm" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <input className="input-field input-sm w-44" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {visible.length > 0 && (
            <button
              className="btn-outline btn-sm"
              onClick={() =>
                downloadCsv(`audit-log`, [
                  { key: 'when', label: 'When', value: (e) => new Date(e.createdAt).toLocaleString() },
                  { key: 'staffName', label: 'Staff' },
                  { key: 'action', label: 'Action' },
                  { key: 'entity', label: 'Entity' },
                  { key: 'details', label: 'Details', value: (e) => JSON.stringify(e.meta) },
                ], visible.map((e) => ({ ...e, when: e.createdAt })))
              }
            >
              <Download className="mr-1 inline h-4 w-4" /> CSV
            </button>
          )}
        </div>
      </div>

      {!entries ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <EmptyState icon={<ScrollText className="mx-auto h-12 w-12 opacity-30" />} title="No entries match your search" />
      ) : (
        <div className="overflow-x-auto card-counter">
          <table className="table-counter">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-xs opacity-70">{fmtDateTime(e.createdAt)}</td>
                  <td className="whitespace-nowrap font-medium">{e.staffName}</td>
                  <td><span className="badge-pill badge-sm font-data">{e.action}</span></td>
                  <td className="font-mono text-xs">
                    {e.entity ?? '—'}
                    {e.entityId ? ` · ${String(e.entityId).slice(0, 8)}…` : ''}
                  </td>
                  <td className="max-w-md truncate text-xs opacity-70">{JSON.stringify(e.meta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

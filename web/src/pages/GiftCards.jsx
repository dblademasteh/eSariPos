import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { fmtDateTime, makeMoney } from '../lib/format.js';
import { useAuth } from '../state/AuthContext.jsx';
import { EmptyState, Field, Modal, Spinner, useToast } from '../components/ui.jsx';
import { Ticket } from 'lucide-react';

export default function GiftCards() {
  const { tenant } = useAuth();
  const toast = useToast();
  const money = makeMoney(tenant?.currency);

  const [cards, setCards] = useState(null);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [reloading, setReloading] = useState(null);
  const [history, setHistory] = useState(null);

  async function load() {
    try {
      setCards(await api('/gift-cards', { query: { search } }));
    } catch (err) {
      toast.error(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [search]);

  async function openHistory(card) {
    try {
      setHistory({ card, rows: await api(`/gift-cards/${card.id}/transactions`) });
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="receipt-head">
        <div className="receipt-meta">
          <span className="font-bold">{tenant?.name}</span>
          <span className="dot" aria-hidden="true"></span>
          <span>{new Date().toLocaleDateString()}</span>
        </div>
        <h1 className="text-xl font-bold">Gift cards</h1>
        <p className="text-sm text-mute">Issue store credit, reload balances, redeem at the register</p>
        <div className="ml-auto flex items-center gap-2 mt-2">
          <input
            className="input-field input-sm w-44 text-ink"
            placeholder="Search code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn-cta btn-sm" onClick={() => setCreating({})}>
            + Issue card
          </button>
        </div>
      </div>

      {!cards ? (
        <Spinner />
      ) : cards.length === 0 ? (
        <EmptyState icon={<Ticket className="mx-auto h-12 w-12 text-mute" />} title="No gift cards yet" subtitle="Issue one to get started." />
      ) : (
        <div className="overflow-x-auto card-counter">
          <table className="table-counter">
            <thead>
              <tr>
                <th className="text-ink">Code</th>
                <th className="text-right text-ink">Balance</th>
                <th className="text-ink">Issued</th>
                <th className="text-ink">Status</th>
                <th className="text-right text-ink">Actions</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id} className={!c.isActive ? 'text-mute' : ''}>
                  <td className="font-data font-medium text-ink">{c.code}</td>
                  <td className="text-right font-semibold text-ink">{money(c.balance)}</td>
                  <td className="text-xs text-mute">{fmtDateTime(c.createdAt)}</td>
                  <td>
                    {c.isActive ? (
                      <span className="badge-pill badge-sm accent">Active</span>
                    ) : (
                      <span className="badge-pill badge-sm">Inactive</span>
                    )}
                  </td>
                  <td className="text-right">
                    <div className="join">
                      <button className="btn-ghost btn-xs text-mute hover:bg-panel hover:text-ink" onClick={() => setReloading(c)}>
                        + Reload
                      </button>
                      <button className="btn-ghost btn-xs text-mute hover:bg-panel hover:text-ink" onClick={() => openHistory(c)}>
                        History
                      </button>
                      <button
                        className={`btn-ghost btn-xs ${c.isActive ? 'text-warn' : 'text-accent'}`}
                        onClick={async () => {
                          try {
                            await api(`/gift-cards/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } });
                            load();
                          } catch (err) {
                            toast.error(err.message);
                          }
                        }}
                      >
                        {c.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <IssueModal
        open={!!creating}
        money={money}
        onClose={() => setCreating(null)}
        onDone={() => {
          setCreating(null);
          load();
        }}
      />

      <ReloadModal
        open={!!reloading}
        card={reloading}
        money={money}
        onClose={() => setReloading(null)}
        onDone={() => {
          setReloading(null);
          load();
        }}
      />

      <Modal
        open={!!history}
        onClose={() => setHistory(null)}
        title={history ? `History · ${history.card.code}` : ''}
      >
        {history && (
          <ul className="space-y-2 text-sm">
            {history.rows.length === 0 && <li className="text-mute">No transactions yet.</li>}
            {history.rows.map((r, idx) => (
              <li key={idx} className="flex items-center justify-between gap-3 rounded-lg bg-panel p-2">
                <div>
                  <div className={r.delta < 0 ? 'font-medium text-warn' : 'font-medium text-accent'}>
                    {r.delta < 0 ? '−' : '+'}
                    {money(Math.abs(r.delta))} {r.orderNo ? `· order #${r.orderNo}` : r.note ? `· ${r.note}` : ''}
                  </div>
                  <div className="text-xs text-mute">{fmtDateTime(r.createdAt)}</div>
                </div>
                <span className="font-data text-xs text-mute">bal {money(r.balanceAfter)}</span>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}

function IssueModal({ open, money, onClose, onDone }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setCode('');
      setAmount('');
    }
  }, [open]);

  async function create() {
    setBusy(true);
    try {
      const card = await api('/gift-cards', {
        method: 'POST',
        body: { code: code.trim() || undefined, initialBalance: Number(amount) || 0 },
      });
      toast.success(`Card ${card.code} issued with ${money(card.balance)}`);
      onDone();
    } catch (err) {
      const detail = Array.isArray(err.details) && err.details.length ? err.details[0].message : err.message;
      toast.error(detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Issue gift card">
      <div className="space-y-3">
        <Field label="Code" hint="Leave blank to auto-generate">
          <input
            className="input-field input-md w-full font-data text-ink uppercase"
            placeholder="GC-XXXXXX"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Starting balance">
          <input
            type="number"
            step="0.01"
            min="0"
            className="input-field input-md w-full text-right text-ink"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <div className="modal-action">
          <button className="btn-ghost text-mute hover:bg-panel hover:text-ink" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn-cta ${busy ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={busy} onClick={create}>
            Issue card
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ReloadModal({ open, card, money, onClose, onDone }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setAmount('');
  }, [open]);

  if (!card) return null;
  const amt = Number(amount) || 0;

  async function reload() {
    setBusy(true);
    try {
      await api(`/gift-cards/${card.id}`, { method: 'PATCH', body: { addBalance: Number(amt.toFixed(2)) } });
      toast.success(`${card.code} reloaded`);
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Reload ${card.code}`}>
      <div className="space-y-3">
        <p className="text-sm text-mute">Current balance: {money(card.balance)}</p>
        <Field label="Add funds">
          <input
            type="number"
            step="0.01"
            min="0"
            className="input-field input-lg w-full text-right text-xl font-bold font-data text-ink"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </Field>
        <div className="modal-action">
          <button className="btn-ghost text-mute hover:bg-panel hover:text-ink" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn-cta ${busy ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={amt <= 0 || busy} onClick={reload}>
            Add {money(amt)}
          </button>
        </div>
      </div>
    </Modal>
  );
}

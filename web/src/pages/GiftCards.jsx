import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { fmtDateTime, makeMoney } from '../lib/format.js';
import { useAuth } from '../state/AuthContext.jsx';
import { EmptyState, Field, Modal, Spinner, useToast } from '../components/ui.jsx';

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
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-xl font-bold">Gift cards</h1>
          <p className="text-sm opacity-60">Issue store credit, reload balances, redeem at the register</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            className="input input-sm w-44"
            placeholder="Search code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-primary btn-sm" onClick={() => setCreating({})}>
            + Issue card
          </button>
        </div>
      </div>

      {!cards ? (
        <Spinner />
      ) : cards.length === 0 ? (
        <EmptyState icon="🎟️" title="No gift cards yet" subtitle="Issue one to get started." />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-base-100 shadow">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th className="text-right">Balance</th>
                <th>Issued</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id} className={!c.isActive ? 'opacity-50' : ''}>
                  <td className="font-mono font-medium">{c.code}</td>
                  <td className="text-right font-semibold">{money(c.balance)}</td>
                  <td className="text-xs opacity-60">{fmtDateTime(c.createdAt)}</td>
                  <td>
                    {c.isActive ? (
                      <span className="badge badge-success badge-sm">Active</span>
                    ) : (
                      <span className="badge badge-ghost badge-sm">Inactive</span>
                    )}
                  </td>
                  <td className="text-right">
                    <div className="join">
                      <button className="btn btn-ghost btn-xs join-item" onClick={() => setReloading(c)}>
                        + Reload
                      </button>
                      <button className="btn btn-ghost btn-xs join-item" onClick={() => openHistory(c)}>
                        History
                      </button>
                      <button
                        className={`btn btn-ghost btn-xs join-item ${c.isActive ? 'text-error' : 'text-success'}`}
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
            {history.rows.length === 0 && <li className="opacity-60">No transactions yet.</li>}
            {history.rows.map((r, idx) => (
              <li key={idx} className="flex items-center justify-between gap-3 rounded-lg bg-base-200 p-2">
                <div>
                  <div className={r.delta < 0 ? 'font-medium text-error' : 'font-medium text-success'}>
                    {r.delta < 0 ? '−' : '+'}
                    {money(Math.abs(r.delta))} {r.orderNo ? `· order #${r.orderNo}` : r.note ? `· ${r.note}` : ''}
                  </div>
                  <div className="text-xs opacity-60">{fmtDateTime(r.createdAt)}</div>
                </div>
                <span className="font-mono text-xs opacity-70">bal {money(r.balanceAfter)}</span>
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
            className="input input-md w-full font-mono uppercase"
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
            className="input input-md w-full text-right"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn btn-primary ${busy ? 'loading' : ''}`} disabled={busy} onClick={create}>
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
        <p className="text-sm opacity-70">Current balance: {money(card.balance)}</p>
        <Field label="Add funds">
          <input
            type="number"
            step="0.01"
            min="0"
            className="input input-lg w-full text-right text-xl font-bold"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </Field>
        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn btn-primary ${busy ? 'loading' : ''}`} disabled={amt <= 0 || busy} onClick={reload}>
            Add {money(amt)}
          </button>
        </div>
      </div>
    </Modal>
  );
}

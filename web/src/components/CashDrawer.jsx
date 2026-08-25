import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { fmtDateTime, makeMoney } from '../lib/format.js';
import { useAuth } from '../state/AuthContext.jsx';
import { Field, Modal, useToast } from './ui.jsx';

// Cash-drawer sessions. Renders NOTHING on its own — the only entry point is
// the account-menu item, which links to /pos?drawer=1.
export default function CashDrawer() {
  const { tenant } = useAuth();
  const money = makeMoney(tenant?.currency);
  const toast = useToast();
  const [modal, setModal] = useState(null); // null | 'open' | 'manage'
  const [session, setSession] = useState(null);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    const drawer = params.get('drawer');
    if (drawer !== '1') return undefined;
    setParams({}, { replace: true }); // strip ?drawer=1 so refresh stays clean
    api('/cash-sessions/current')
      .then((data) => {
        setSession(data.session);
        setModal(data.session ? 'manage' : 'open');
      })
      .catch(() => {
        toast.error('Could not load drawer state');
        setModal(null);
      });
    return undefined;
  }, [params]);

  return (
    <>
      <OpenDrawerModal open={modal === 'open'} onClose={() => setModal(null)} onDone={() => setModal(null)} />
      <ManageDrawerModal
        open={modal === 'manage'}
        session={session}
        money={money}
        onClose={() => setModal(null)}
      />
    </>
  );
}

function OpenDrawerModal({ open, onClose }) {
  const toast = useToast();
  const [float, setFloat] = useState('100.00');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setFloat('100.00');
      setBusy(false);
    }
  }, [open]);

  async function submitOpen() {
    setBusy(true);
    try {
      await api('/cash-sessions/open', {
        method: 'POST',
        body: { openingFloat: Number(float) || 0 },
      });
      toast.success('Drawer opened - good selling!');
      onClose();
    } catch (err) {
      if (/already have an open drawer/i.test(err.message)) {
        toast.info('You already have a drawer open');
        onClose();
      } else {
        toast.error(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Start shift · opening float">
      <div className="space-y-3">
        <Field label="Opening float" hint="Cash you start the shift with">
          <input type="number" min="0" step="0.01" className="input input-lg w-full text-right text-xl font-bold" value={float} onChange={(e) => setFloat(e.target.value)} autoFocus />
        </Field>
        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Not now
          </button>
          <button className={`btn btn-primary ${busy ? 'loading' : ''}`} disabled={busy || !(Number(float) >= 0)} onClick={submitOpen}>
            Open drawer
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ManageDrawerModal({ open, session, money, onClose }) {
  const toast = useToast();
  const [report, setReport] = useState(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [counted, setCounted] = useState('');
  const [zReport, setZReport] = useState(null);

  useEffect(() => {
    if (open && session?.sessionId) {
      api(`/cash-sessions/${session.sessionId}/report`).then(setReport).catch((err) => toast.error(err.message));
      setZReport(null);
      setCounted('');
    }
  }, [open, session]);

  if (!open || !session) return null;

  async function addEvent(type) {
    try {
      await api(`/cash-sessions/${session.sessionId}/events`, {
        method: 'POST',
        body: { type, amount: Number(amount), note: note || null },
      });
      setAmount('');
      setNote('');
      setReport(await api(`/cash-sessions/${session.sessionId}/report`));
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function close() {
    try {
      const { zReport: z } = await api(`/cash-sessions/${session.sessionId}/close`, {
        method: 'POST',
        body: { countedCash: Number(counted), note: note || null },
      });
      setZReport(z);
    } catch (err) {
      toast.error(err.message);
    }
  }

  const row = (label, value, cls = '') => (
    <div className={`flex justify-between text-sm ${cls}`}>
      <span className="opacity-70">{label}</span>
      <span>{value}</span>
    </div>
  );

  const reportView = zReport ?? report;
  const isZ = Boolean(zReport);

  return (
    <Modal open={open} onClose={onClose} title={isZ ? 'Z-report · drawer closed' : 'Your drawer'} wide>
      {!reportView ? (
        <p className="py-6 text-center opacity-60">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="print-area rounded-xl bg-base-200 p-4 font-mono text-sm">
            <div className="text-center font-bold">
              {isZ ? '*** Z-REPORT ***' : `X-REPORT · ${fmtDateTime(reportView.openedAt)}`}
            </div>
            <div className="mt-2 space-y-1">
              {row('Opened by', reportView.openedBy ?? '—')}
              {row('Orders', reportView.ordersCount)}
              {row('Gross sales', money(reportView.grossSales))}
              {(reportView.refunds ?? 0) > 0 && row('Refunds', `- ${money(reportView.refunds)}`)}
              {row('Net sales', money(reportView.netSales), 'border-t border-base-300 pt-1 font-bold')}
            </div>
            <div className="mt-2 space-y-1 border-t border-dashed border-base-300 pt-2">
              {Object.entries(reportView.byMethod).map(([m, amt]) => (
                <div key={m}>{row(m.replace('_', ' '), money(amt))}</div>
              ))}
            </div>
            <div className="mt-2 space-y-1 border-t border-dashed border-base-300 pt-2">
              {row('Opening float', money(reportView.openingFloat))}
              {row('Cash sales (less change)', money(reportView.cashKept))}
              {(reportView.drops ?? 0) > 0 && row('Drops', `- ${money(reportView.drops)}`)}
              {(reportView.payouts ?? 0) > 0 && row('Payouts', `- ${money(reportView.payouts)}`)}
              {row('Expected in drawer', money(reportView.expectedCash), 'font-bold')}
              {isZ && (
                <>
                  {row('Counted', money(reportView.countedCash))}
                  <div className={`flex justify-between font-bold ${reportView.variance === 0 ? '' : reportView.variance > 0 ? 'text-success' : 'text-error'}`}>
                    <span>Variance</span>
                    <span>{money(reportView.variance)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {!isZ && (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[110px_1fr_90px]">
                <select aria-label="Cash movement type" className="select select-sm" value="" onChange={(e) => e.target.value && addEvent(e.target.value)}>
                  <option value="">Cash out…</option>
                  <option value="drop">Drop to safe</option>
                  <option value="payout">Expense payout</option>
                </select>
                <input type="number" min="0" step="0.01" aria-label="Amount" className="input input-sm" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <input aria-label="Note" className="input input-sm" placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div className="rounded-xl bg-warning/10 p-3">
                <div className="mb-1 text-xs uppercase tracking-wide opacity-60">Close shift (Z)</div>
                <div className="flex items-center gap-2">
                  <input type="number" min="0" step="0.01" className="input input-sm flex-1" placeholder={`Counted cash · expect ${money(reportView.expectedCash)}`} value={counted} onChange={(e) => setCounted(e.target.value)} />
                  <button className="btn btn-primary btn-sm" disabled={!(Number(counted) >= 0)} onClick={close}>
                    Close & print Z
                  </button>
                </div>
              </div>
            </>
          )}

          <div className="modal-action print:hidden">
            {isZ && (
              <button className="btn mr-auto" onClick={() => window.print()}>
                🖨️ Print Z-report
              </button>
            )}
            <button className="btn btn-primary" onClick={onClose}>
              {isZ ? 'Done' : 'Hide'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

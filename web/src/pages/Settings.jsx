import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../state/AuthContext.jsx';
import { Field, useToast } from '../components/ui.jsx';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'AED', 'INR', 'BRL', 'MXN', 'ZAR', 'SGD', 'PHP'];
const ROUNDING_MODES = [
  { value: 'none', label: 'No cash rounding' },
  { value: 'step5', label: 'Nearest 0.05' },
  { value: 'step10', label: 'Nearest 0.10' },
  { value: 'step100', label: 'Nearest whole unit' },
];

function TwoFactorCard() {
  const toast = useToast();
  const { isOwner, user } = useAuth();
  const [enabled, setEnabled] = useState(null);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    api('/staff')
      .then((list) => {
        const me = list.find((s) => s.email === user?.email);
        setEnabled(Boolean(me?.totpEnabled));
      })
      .catch(() => setEnabled(false));
  }, [isOwner, user?.email]);

  return enabled === null ? null : (
    <div className="card bg-base-100 p-6 shadow">
      <h2 className="mb-1 font-bold">Two-factor authentication</h2>
      <p className="mb-3 text-sm opacity-60">
        {enabled
          ? 'Your account requires an authenticator code at sign-in.'
          : 'Add a second step to owner sign-ins using any TOTP app (Google Authenticator, Aegis, …).'}
      </p>

      {!enabled && !setup && (
        <button className={`btn btn-primary btn-sm ${busy ? 'loading' : ''}`} disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            setSetup(await api('/auth/2fa/setup', { method: 'POST', body: {} }));
          } catch (err) {
            toast.error(err.message);
          } finally { setBusy(false); }
        }}>
          Set up 2FA
        </button>
      )}

      {setup && (
        <div className="space-y-3">
          <div className="rounded-xl bg-base-200 p-3 text-sm">
            <ol className="list-decimal space-y-1 pl-5">
              <li>Add a new account in your authenticator app.</li>
              <li>Choose "Enter a setup key" and paste this secret:</li>
            </ol>
            <code className="mt-2 block break-all rounded bg-base-100 p-2 font-mono text-base">{setup.secret}</code>
            <p className="mt-2 text-xs opacity-60">Or paste this URI into your app:</p>
            <code className="block break-all rounded bg-base-100 p-2 text-xs">{setup.otpauthUri}</code>
          </div>
          <Field label="Enter the current 6-digit code">
            <input className="input input-md w-full text-center font-mono tracking-[0.4em]" maxLength={6} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <button className={`btn btn-primary btn-sm ${busy ? 'loading' : ''}`} disabled={code.length !== 6 || busy} onClick={async () => {
            setBusy(true);
            try {
              await api('/auth/2fa/enable', { method: 'POST', body: { code } });
              toast.success('Two-factor enabled');
              setSetup(null);
              setEnabled(true);
            } catch (err) { toast.error(err.message); } finally { setBusy(false); }
          }}>
            Verify & enable
          </button>
        </div>
      )}

      {enabled && (
        <DisableTwoFactor onDisabled={() => setEnabled(false)} />
      )}
    </div>
  );
}

function DisableTwoFactor({ onDisabled }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-end gap-2">
      <input className="input input-sm w-32 text-center font-mono" placeholder="Code" maxLength={6} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      <button className={`btn btn-outline btn-error btn-sm ${busy ? 'loading' : ''}`} disabled={code.length !== 6 || busy} onClick={async () => {
        setBusy(true);
        try {
          await api('/auth/2fa/disable', { method: 'POST', body: { code } });
          toast.success('Two-factor disabled');
          onDisabled();
        } catch (err) { toast.error(err.message); } finally { setBusy(false); }
      }}>
        Disable 2FA
      </button>
    </div>
  );
}

function DigestCard() {
  const toast = useToast();
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);

  async function preview() {
    setBusy(true);
    try {
      setSummary(await api('/reports/daily-summary', { query: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, daysAgo: 1 } }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card bg-base-100 p-6 shadow">
      <h2 className="mb-1 font-bold">Daily email digest</h2>
      <p className="mb-3 text-sm opacity-60">
        A summary of yesterday (orders, revenue, top seller, low stock) is built daily at 06:00 server time and sent
        to owners. Delivery activates once <code className="font-mono text-xs">SMTP_URL</code> +{' '}
        <code className="font-mono text-xs">MAIL_FROM</code> are configured — until then it runs in dry-run mode.
      </p>
      {!summary ? (
        <button className={`btn btn-sm btn-outline ${busy ? 'loading' : ''}`} disabled={busy} onClick={preview}>
          Preview yesterday's digest
        </button>
      ) : (
        <div className="rounded-xl bg-base-200 p-3 font-mono text-sm">
          <div>Orders: {summary.ordersCount}</div>
          <div>Net revenue: {summary.revenue.toFixed(2)}</div>
          <div>Top seller: {summary.topProduct ?? '—'}</div>
          <div>Low stock items: {summary.lowStockCount}</div>
        </div>
      )}
    </div>
  );
}

function PlatformCard() {
  const toast = useToast();
  const [keys, setKeys] = useState(null);
  const [hooks, setHooks] = useState(null);
  const [newKey, setNewKey] = useState(null);
  const [newHookSecret, setNewHookSecret] = useState(null);
  const [label, setLabel] = useState('');
  const [hookUrl, setHookUrl] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [k, h] = await Promise.all([api('/api-keys'), api('/webhooks')]);
      setKeys(k);
      setHooks(h);
    } catch (err) {
      toast.error(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card bg-base-100 p-6 shadow">
        <h2 className="mb-1 font-bold">Public API keys</h2>
        <p className="mb-3 text-sm opacity-60">Read-only reporting access via the <code className="font-mono text-xs">X-Api-Key</code> header.</p>
        {newKey && (
          <div className="mb-3 rounded-xl bg-success/10 p-3 text-sm">
            Copy this key now — it is shown once:
            <code className="mt-1 block break-all font-mono">{newKey}</code>
          </div>
        )}
        <ul className="mb-3 space-y-1 text-sm">
          {(keys ?? []).map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-2 rounded-lg bg-base-200 px-2 py-1">
              <span className={k.revoked ? 'line-through opacity-50' : ''}>
                {k.label} · <span className="font-mono text-xs">{k.key_prefix}…</span>
              </span>
              {!k.revoked && (
                <button className="btn btn-ghost btn-xs text-error" onClick={async () => {
                  try { await api(`/api-keys/${k.id}`, { method: 'PATCH', body: { revoked: true } }); load(); } catch (e) { toast.error(e.message); }
                }}>revoke</button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-2">
          <input className="input input-sm flex-1" placeholder="Key label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <button className={`btn btn-primary btn-sm ${busy ? 'loading' : ''}`} disabled={!label.trim() || busy} onClick={async () => {
            setBusy(true);
            try {
              const created = await api('/api-keys', { method: 'POST', body: { label } });
              setNewKey(created.key);
              setLabel('');
              await load();
            } catch (err) { toast.error(err.message); } finally { setBusy(false); }
          }}>Generate</button>
        </div>
      </div>

      <div className="card bg-base-100 p-6 shadow">
        <h2 className="mb-1 font-bold">Webhooks</h2>
        <p className="mb-3 text-sm opacity-60">Signed with HMAC-SHA256 (<code className="font-mono text-xs">X-NovaPOS-Signature</code>).</p>
        {newHookSecret && (
          <div className="mb-3 rounded-xl bg-success/10 p-3 text-sm">
            Signing secret (shown once):
            <code className="mt-1 block break-all font-mono">{newHookSecret}</code>
          </div>
        )}
        <ul className="mb-3 space-y-1 text-sm">
          {(hooks ?? []).map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-2 rounded-lg bg-base-200 px-2 py-1">
              <span className="min-w-0 truncate">{w.url}</span>
              <span className="whitespace-nowrap text-xs opacity-60">{w.deliveries} sent · {w.failures} failed</span>
              {w.isActive && (
                <button className="btn btn-ghost btn-xs text-error" onClick={async () => {
                  try { await api(`/webhooks/${w.id}`, { method: 'PATCH', body: { isActive: false } }); load(); } catch (e) { toast.error(e.message); }
                }}>off</button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-2">
          <input className="input input-sm flex-1" placeholder="https://your-app.example/hook" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} />
          <button className={`btn btn-primary btn-sm ${busy ? 'loading' : ''}`} disabled={!hookUrl.startsWith('http') || busy} onClick={async () => {
            setBusy(true);
            try {
              const created = await api('/webhooks', { method: 'POST', body: { url: hookUrl, events: ['order.created'] } });
              setNewHookSecret(created.secret);
              setHookUrl('');
              await load();
            } catch (err) { toast.error(err.message); } finally { setBusy(false); }
          }}>Add</button>
        </div>
      </div>
    </div>
  );
}

const toForm = (t) => ({
  name: t?.name ?? '',
  address: t?.address ?? '',
  phone: t?.phone ?? '',
  currency: t?.currency ?? 'USD',
  taxRate: t?.taxRate ?? 0,
  receiptFooter: t?.receiptFooter ?? '',
  surchargePct: t?.surchargePct ?? 0,
  cashRounding: t?.cashRounding ?? 'none',
  loyaltyEarnPerUnit: t?.loyaltyEarnPerUnit ?? 1,
  loyaltyPointCents: t?.loyaltyPointCents ?? 1,
});

export default function Settings() {
  const { tenant, refreshMe, isOwner } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(() => toForm(tenant));

  useEffect(() => {
    setForm(toForm(tenant));
  }, [tenant]);
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/settings', {
        method: 'PATCH',
        body: {
          name: form.name,
          address: form.address || null,
          phone: form.phone || null,
          currency: form.currency,
          taxRate: Number(form.taxRate),
          receiptFooter: form.receiptFooter || null,
          surchargePct: Number(form.surchargePct) || 0,
          cashRounding: form.cashRounding,
          loyaltyEarnPerUnit: Number(form.loyaltyEarnPerUnit) || 0,
          loyaltyPointCents: Number(form.loyaltyPointCents) || 1,
        },
      });
      await refreshMe();
      toast.success('Settings saved');
    } catch (err) {
      const detail = Array.isArray(err.details) && err.details.length ? err.details[0].message : err.message;
      toast.error(detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Business settings</h1>
        <p className="text-sm opacity-60">
          Business ID <span className="font-mono">{tenant?.slug}</span> · these details appear on receipts
        </p>
      </div>

      <form onSubmit={save} className="card bg-base-100 p-6 shadow">
        <div className="space-y-4">
          <Field label="Business name">
            <input className="input input-md w-full" value={form.name} onChange={set('name')} required />
          </Field>

          <Field label="Address">
            <input className="input input-md w-full" value={form.address} onChange={set('address')} />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Phone">
              <input className="input input-md w-full" value={form.phone} onChange={set('phone')} />
            </Field>
            <Field label="Currency">
              <select className="select select-md w-full" value={form.currency} onChange={set('currency')}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Tax rate (%)">
              <input
                type="number"
                step="0.01"
                min="0"
                max="99.99"
                className="input input-md w-full"
                value={form.taxRate}
                onChange={set('taxRate')}
              />
            </Field>
          </div>

          <Field label="Receipt footer">
            <textarea
              className="textarea textarea-md w-full"
              rows={2}
              placeholder="Thanks for shopping with us!"
              value={form.receiptFooter}
              onChange={set('receiptFooter')}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Service charge (%)" hint="Added after tax on every sale">
              <input
                type="number"
                step="0.01"
                min="0"
                max="99.99"
                className="input input-md w-full"
                value={form.surchargePct}
                onChange={set('surchargePct')}
              />
            </Field>
            <Field label="Cash rounding" hint="Applied when a sale includes cash">
              <select
                className="select select-md w-full"
                value={form.cashRounding}
                onChange={set('cashRounding')}
              >
                {ROUNDING_MODES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Loyalty earn rate" hint="Points per whole currency unit spent">
              <input
                type="number"
                min="0"
                max="1000"
                className="input input-md w-full"
                value={form.loyaltyEarnPerUnit}
                onChange={set('loyaltyEarnPerUnit')}
              />
            </Field>
            <Field label="Point value (cents)" hint="Value of one point when redeeming">
              <input
                type="number"
                min="1"
                max="10000"
                className="input input-md w-full"
                value={form.loyaltyPointCents}
                onChange={set('loyaltyPointCents')}
              />
            </Field>
          </div>

          <div className="flex justify-end">
            <button className={`btn btn-primary ${busy ? 'loading' : ''}`} disabled={busy}>
              Save settings
            </button>
          </div>
        </div>
      </form>

      {isOwner && <TwoFactorCard />}
      {isOwner && <DigestCard />}
      {isOwner && <PlatformCard />}
    </div>
  );
}

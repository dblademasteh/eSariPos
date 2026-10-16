import { useEffect, useState } from 'react';
import { Building2, Banknote, Receipt, Wallet, Star, Package, Lock, Plug } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../state/AuthContext.jsx';
import { Field, useToast } from '../components/ui.jsx';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'AED', 'INR', 'BRL', 'MXN', 'ZAR', 'SGD', 'PHP'];
const ROUNDING_MODES = [
  { value: 'none', label: 'No rounding' },
  { value: 'step5', label: 'Nearest ₱0.05' },
  { value: 'step10', label: 'Nearest ₱0.10' },
  { value: 'step100', label: 'Nearest ₱1' },
];
const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card (manual)' },
  { value: 'card_terminal', label: 'Card terminal' },
  { value: 'mobile', label: 'Mobile / QR' },
  { value: 'gcash', label: 'GCash' },
  { value: 'maya', label: 'Maya (PayMaya)' },
  { value: 'other', label: 'Other' },
];
const TIMEZONES = [
  'UTC',
  'US/Eastern', 'US/Central', 'US/Mountain', 'US/Pacific',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Asia/Manila',
  'Asia/Singapore', 'Asia/Dubai', 'Australia/Sydney', 'Pacific/Auckland',
  'America/Sao_Paulo', 'America/Mexico_City', 'Africa/Johannesburg',
];

const TABS = [
  { id: 'business', label: 'Store' },
  { id: 'financial', label: 'Money' },
  { id: 'receipt', label: 'Receipt' },
  { id: 'register', label: 'Register' },
  { id: 'loyalty', label: 'Loyalty' },
  { id: 'inventory', label: 'Stock' },
  { id: 'security', label: 'Security' },
  { id: 'integrations', label: 'Integrations' },
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

  if (enabled === null) return null;

  return (
    <div className="space-y-3">
      <p className="text-sm opacity-60">
        {enabled
          ? 'Your account requires an authenticator code at sign-in.'
          : 'Add a second step to owner sign-ins using any TOTP app (Google Authenticator, Aegis, …).'}
      </p>
      {!enabled && !setup && (
        <button className={`btn-cta btn-sm ${busy ? 'opacity-50 pointer-events-none' : ''}`} disabled={busy} onClick={async () => {
          setBusy(true);
          try { setSetup(await api('/auth/2fa/setup', { method: 'POST', body: {} })); }
          catch (err) { toast.error(err.message); } finally { setBusy(false); }
        }}>Set up 2FA</button>
      )}
      {setup && (
        <div className="space-y-3">
          <div className="bg-panel rounded-lg p-3 text-sm">
            <ol className="list-decimal space-y-1 pl-5">
              <li>Add a new account in your authenticator app.</li>
              <li>Choose "Enter a setup key" and paste this secret:</li>
            </ol>
            <code className="mt-2 block break-all rounded bg-paper p-2 font-data text-base">{setup.secret}</code>
            <p className="mt-2 text-xs opacity-60">Or paste this URI into your app:</p>
            <code className="block break-all rounded bg-paper p-2 text-xs">{setup.otpauthUri}</code>
          </div>
          <Field label="Enter the current 6-digit code">
            <input className="input-field input-md w-full text-center font-data tracking-[0.4em]" maxLength={6} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <button className={`btn-cta btn-sm ${busy ? 'opacity-50 pointer-events-none' : ''}`} disabled={code.length !== 6 || busy} onClick={async () => {
            setBusy(true);
            try { await api('/auth/2fa/enable', { method: 'POST', body: { code } }); toast.success('Two-factor enabled'); setSetup(null); setEnabled(true); }
            catch (err) { toast.error(err.message); } finally { setBusy(false); }
          }}>Verify & enable</button>
        </div>
      )}
      {enabled && <DisableTwoFactor onDisabled={() => setEnabled(false)} />}
    </div>
  );
}

function DisableTwoFactor({ onDisabled }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-end gap-2">
      <input className="input-field input-sm w-32 text-center font-data" placeholder="Code" maxLength={6} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      <button className={`btn-outline btn-warn btn-sm ${busy ? 'opacity-50 pointer-events-none' : ''}`} disabled={code.length !== 6 || busy} onClick={async () => {
        setBusy(true);
        try { await api('/auth/2fa/disable', { method: 'POST', body: { code } }); toast.success('Two-factor disabled'); onDisabled(); }
        catch (err) { toast.error(err.message); } finally { setBusy(false); }
      }}>Disable 2FA</button>
    </div>
  );
}

function DigestCard() {
  const toast = useToast();
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);

  async function preview() {
    setBusy(true);
    try { setSummary(await api('/reports/daily-summary', { query: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, daysAgo: 1 } })); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm opacity-60">
        A summary of yesterday (orders, revenue, top seller, low stock) is built daily at 06:00 server time and sent
        to owners. Delivery activates once <code className="font-data text-xs">SMTP_URL</code> +{' '}
        <code className="font-data text-xs">MAIL_FROM</code> are configured — until then it runs in dry-run mode.
      </p>
      {!summary ? (
        <button className={`btn-outline btn-sm ${busy ? 'opacity-50 pointer-events-none' : ''}`} disabled={busy} onClick={preview}>
          Preview yesterday's digest
        </button>
      ) : (
        <div className="bg-panel rounded-lg p-3 font-data text-sm">
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
      setKeys(k); setHooks(h);
    } catch (err) { toast.error(err.message); }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 font-semibold">API keys</h3>
        <p className="mb-3 text-sm opacity-60">Read-only reporting access via the <code className="font-data text-xs">X-Api-Key</code> header.</p>
        {newKey && (
          <div className="mb-3 bg-accent-dim rounded-lg p-3 text-sm">
            Copy this key now — it is shown once:
            <code className="mt-1 block break-all font-data">{newKey}</code>
          </div>
        )}
        <ul className="mb-3 space-y-1 text-sm">
          {(keys ?? []).map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-2 rounded-lg bg-panel px-2 py-1">
              <span className={k.revoked ? 'line-through opacity-50' : ''}>
                {k.label} · <span className="font-data text-xs">{k.key_prefix}…</span>
              </span>
              {!k.revoked && (
                <button className="btn-ghost btn-xs text-warn" onClick={async () => {
                  try { await api(`/api-keys/${k.id}`, { method: 'PATCH', body: { revoked: true } }); load(); }
                  catch (e) { toast.error(e.message); }
                }}>revoke</button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-2">
          <input className="input-field input-sm flex-1" placeholder="Key label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <button className={`btn-cta btn-sm ${busy ? 'opacity-50 pointer-events-none' : ''}`} disabled={!label.trim() || busy} onClick={async () => {
            setBusy(true);
            try { const created = await api('/api-keys', { method: 'POST', body: { label } }); setNewKey(created.key); setLabel(''); await load(); }
            catch (err) { toast.error(err.message); } finally { setBusy(false); }
          }}>Generate</button>
        </div>
      </div>

      <div className="receipt-line" />

      <div>
        <h3 className="mb-2 font-semibold">Webhooks</h3>
        <p className="mb-3 text-sm opacity-60">Signed with HMAC-SHA256 (<code className="font-data text-xs">X-eSariPOS-Signature</code>).</p>
        {newHookSecret && (
          <div className="mb-3 bg-accent-dim rounded-lg p-3 text-sm">
            Signing secret (shown once):
            <code className="mt-1 block break-all font-data">{newHookSecret}</code>
          </div>
        )}
        <ul className="mb-3 space-y-1 text-sm">
          {(hooks ?? []).map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-2 rounded-lg bg-panel px-2 py-1">
              <span className="min-w-0 truncate">{w.url}</span>
              <span className="whitespace-nowrap text-xs opacity-60">{w.deliveries} sent · {w.failures} failed</span>
              {w.isActive && (
                <button className="btn-ghost btn-xs text-warn" onClick={async () => {
                  try { await api(`/webhooks/${w.id}`, { method: 'PATCH', body: { isActive: false } }); load(); }
                  catch (e) { toast.error(e.message); }
                }}>off</button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-2">
          <input className="input-field input-sm flex-1" placeholder="https://your-app.example/hook" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} />
          <button className={`btn-cta btn-sm ${busy ? 'opacity-50 pointer-events-none' : ''}`} disabled={!hookUrl.startsWith('http') || busy} onClick={async () => {
            setBusy(true);
            try { const created = await api('/webhooks', { method: 'POST', body: { url: hookUrl, events: ['order.created'] } }); setNewHookSecret(created.secret); setHookUrl(''); await load(); }
            catch (err) { toast.error(err.message); } finally { setBusy(false); }
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
  loyaltyMinRedeem: t?.loyaltyMinRedeem ?? 100,
  loyaltyMaxRedemptionPct: t?.loyaltyMaxRedemptionPct ?? 100,
  loyaltyExpiryDays: t?.loyaltyExpiryDays ?? 0,
  inventoryStockMode: t?.inventoryStockMode ?? 'track',
  inventoryRequireAdjustmentNote: t?.inventoryRequireAdjustmentNote ?? true,
  inventoryAutoReorder: t?.inventoryAutoReorder ?? false,
  timezone: t?.timezone ?? 'UTC',
  taxInclusive: t?.taxInclusive ?? false,
  defaultOpeningFloat: t?.defaultOpeningFloat ?? 100,
  lowStockAlertThreshold: t?.lowStockAlertThreshold ?? 5,
  receiptHeader: t?.receiptHeader ?? '',
  logoUrl: t?.logoUrl ?? '',
  defaultPaymentMethod: t?.defaultPaymentMethod ?? 'cash',
  tipsEnabled: t?.tipsEnabled ?? false,
  tipSuggestions: t?.tipSuggestions ?? '10,15,20',
  autoCloseDrawerHours: t?.autoCloseDrawerHours ?? 0,
  receiptWidth: t?.receiptWidth ?? 40,
  autoPrintReceipt: t?.autoPrintReceipt ?? true,
  openDrawerOnCash: t?.openDrawerOnCash ?? true,
  allowNegativeStock: t?.allowNegativeStock ?? false,
  maxDiscountPct: t?.maxDiscountPct ?? 100,
  requireCustomer: t?.requireCustomer ?? false,
  tin: t?.tin ?? '',
  birAccreditationNo: t?.birAccreditationNo ?? '',
  machineSerialNo: t?.machineSerialNo ?? '',
});

export default function Settings() {
  const { tenant, refreshMe, isOwner } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(() => toForm(tenant));
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState('business');

  useEffect(() => { setForm(toForm(tenant)); }, [tenant]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setChecked = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.checked }));

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
          loyaltyMinRedeem: Number(form.loyaltyMinRedeem) || 0,
          loyaltyMaxRedemptionPct: Number(form.loyaltyMaxRedemptionPct) || 100,
          loyaltyExpiryDays: Number(form.loyaltyExpiryDays) || 0,
          inventoryStockMode: form.inventoryStockMode,
          inventoryRequireAdjustmentNote: form.inventoryRequireAdjustmentNote,
          inventoryAutoReorder: form.inventoryAutoReorder,
          timezone: form.timezone,
          taxInclusive: form.taxInclusive,
          defaultOpeningFloat: Number(form.defaultOpeningFloat) || 0,
          lowStockAlertThreshold: Number(form.lowStockAlertThreshold) || 0,
          receiptHeader: form.receiptHeader || null,
          logoUrl: form.logoUrl || null,
          defaultPaymentMethod: form.defaultPaymentMethod,
          tipsEnabled: form.tipsEnabled,
          tipSuggestions: form.tipSuggestions || '10,15,20',
          autoCloseDrawerHours: Number(form.autoCloseDrawerHours) || 0,
          receiptWidth: Number(form.receiptWidth) || 40,
          autoPrintReceipt: form.autoPrintReceipt,
          openDrawerOnCash: form.openDrawerOnCash,
          allowNegativeStock: form.allowNegativeStock,
          maxDiscountPct: Number(form.maxDiscountPct) || 0,
          requireCustomer: form.requireCustomer,
          tin: form.tin || null,
          birAccreditationNo: form.birAccreditationNo || null,
          machineSerialNo: form.machineSerialNo || null,
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
    <div className="mx-auto max-w-3xl">
      <div className="receipt-head">
        <div className="receipt-meta">
          <span className="font-bold">{tenant?.name}</span>
          <span className="dot" aria-hidden="true"></span>
          <span>{new Date().toLocaleDateString()}</span>
        </div>
        <h1 className="text-display">Settings</h1>
        <p className="text-sm opacity-60">Business ID <span className="font-data">{tenant?.slug}</span></p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-8 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`flex-1 btn-ghost ${activeTab === tab.id ? 'bg-accent text-white' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <form onSubmit={save}>
        {/* ── Business ── */}
        {activeTab === 'business' && (
          <div className="card-counter">
            <div className="space-y-5">
              <span className="eyebrow">Store details</span>
              <Field label="Business name">
                <input className="input-field input-md w-full" value={form.name} onChange={set('name')} required />
              </Field>
              <Field label="Address">
                <input className="input-field input-md w-full" value={form.address} onChange={set('address')} />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Phone">
                  <input className="input-field input-md w-full" value={form.phone} onChange={set('phone')} />
                </Field>
                <Field label="Logo URL" hint="Shown on receipts and login page">
                  <input className="input-field input-md w-full" placeholder="https://…" value={form.logoUrl} onChange={set('logoUrl')} />
                </Field>
              </div>
              <Field label="Business timezone" hint="Used for digest emails and report defaults">
                <select className="select-field input-md w-full" value={form.timezone} onChange={set('timezone')}>
                  {TIMEZONES.map((tz) => <option key={tz}>{tz}</option>)}
                </select>
              </Field>

              <span className="eyebrow">BIR Compliance (Philippines)</span>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="TIN (Tax Identification Number)" hint="Required on Official Receipts">
                  <input className="input-field input-md w-full" placeholder="000-000-000-000" value={form.tin} onChange={set('tin')} />
                </Field>
                <Field label="BIR Accreditation No." hint="POS system BIR permit number">
                  <input className="input-field input-md w-full" placeholder="BIR-0000-00000000" value={form.birAccreditationNo} onChange={set('birAccreditationNo')} />
                </Field>
                <Field label="Machine / Printer Serial No." hint="POS machine serial number">
                  <input className="input-field input-md w-full" placeholder="SN-000000" value={form.machineSerialNo} onChange={set('machineSerialNo')} />
                </Field>
              </div>
            </div>
          </div>
        )}

        {/* ── Financial ── */}
        {activeTab === 'financial' && (
          <div className="card-counter">
            <div className="space-y-5">
              <span className="eyebrow">Money settings</span>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Currency">
                  <select className="select-field input-md w-full" value={form.currency} onChange={set('currency')}>
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Tax rate (%)">
                  <input type="number" step="0.01" min="0" max="99.99" className="input-field input-md w-full" value={form.taxRate} onChange={set('taxRate')} />
                </Field>
                <Field label="Service charge (%)" hint="Added after tax on every sale">
                  <input type="number" step="0.01" min="0" max="99.99" className="input-field input-md w-full" value={form.surchargePct} onChange={set('surchargePct')} />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex items-center gap-3">
                  <input type="checkbox" className="checkbox-field" checked={form.taxInclusive} onChange={setChecked('taxInclusive')} />
                  <div>
                    <div className="text-sm font-medium">Tax-inclusive pricing</div>
                    <div className="text-xs opacity-60">Displayed prices already include tax</div>
                  </div>
                </label>
                <Field label="Cash rounding" hint="Applied when a sale includes cash">
                  <select className="select-field input-md w-full" value={form.cashRounding} onChange={set('cashRounding')}>
                    {ROUNDING_MODES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </Field>
              </div>
            </div>
          </div>
        )}

        {/* ── Receipt ── */}
        {activeTab === 'receipt' && (
          <div className="card-counter">
            <div className="space-y-5">
              <span className="eyebrow">Receipt text</span>
              <Field label="Header text" hint="Shown above business name on receipts">
                <textarea className="input-field w-full" rows={2} placeholder="Welcome to our store!" value={form.receiptHeader} onChange={set('receiptHeader')} />
              </Field>
              <Field label="Footer text" hint="Shown at the bottom of receipts">
                <textarea className="input-field w-full" rows={2} placeholder="Thanks for shopping with us!" value={form.receiptFooter} onChange={set('receiptFooter')} />
              </Field>
              <Field label="Paper width">
                <select className="select-field input-md w-full" value={form.receiptWidth} onChange={(e) => setForm((f) => ({ ...f, receiptWidth: Number(e.target.value) }))}>
                  <option value={40}>40 columns (standard)</option>
                  <option value={80}>80 columns (wide)</option>
                </select>
              </Field>
            </div>
          </div>
        )}

        {/* ── Register ── */}
        {activeTab === 'register' && (
          <div className="card-counter">
            <div className="space-y-5">
              <span className="eyebrow">Register defaults</span>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Default opening float" hint="Starting cash when opening a drawer">
                  <input type="number" step="0.01" min="0" className="input-field input-md w-full" value={form.defaultOpeningFloat} onChange={set('defaultOpeningFloat')} />
                </Field>
                <Field label="Auto-close drawer (hours)" hint="0 = disabled">
                  <input type="number" min="0" max="24" className="input-field input-md w-full" value={form.autoCloseDrawerHours} onChange={set('autoCloseDrawerHours')} />
                </Field>
              </div>
              <Field label="Default payment method" hint="Pre-selected in the checkout dialog">
                <select className="select-field input-md w-full sm:w-80" value={form.defaultPaymentMethod} onChange={set('defaultPaymentMethod')}>
                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field>

              <span className="eyebrow">Checkout behavior</span>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="checkbox-field mt-0.5"
                  checked={form.autoPrintReceipt}
                  onChange={setChecked('autoPrintReceipt')}
                />
                <div>
                  <div className="text-sm font-medium">Show receipt after every sale</div>
                  <div className="text-xs opacity-60">Open the print dialog automatically on checkout completion. Turn off for faster back-to-back selling — receipts stay available in Orders.</div>
                </div>
              </label>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="checkbox-field mt-0.5"
                  checked={form.openDrawerOnCash}
                  onChange={setChecked('openDrawerOnCash')}
                />
                <div>
                  <div className="text-sm font-medium">Kick cash drawer on cash payment</div>
                  <div className="text-xs opacity-60">Send a drawer-open pulse whenever a sale includes cash.</div>
                </div>
              </label>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="checkbox-field mt-0.5"
                  checked={form.requireCustomer}
                  onChange={setChecked('requireCustomer')}
                />
                <div>
                  <div className="text-sm font-medium">Require customer at checkout</div>
                  <div className="text-xs opacity-60">Block completing a sale until a customer is selected. Recommended if you rely on loyalty points.</div>
                </div>
              </label>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="checkbox-field mt-0.5"
                  checked={form.allowNegativeStock}
                  onChange={setChecked('allowNegativeStock')}
                />
                <div>
                  <div className="text-sm font-medium">Allow overselling</div>
                  <div className="text-xs opacity-60">Permit sales beyond available stock — useful for services and made-to-order items.</div>
                </div>
              </label>

              <span className="eyebrow">Discounts & tips</span>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Max discount (%)" hint="Percentage discounts above this are clamped unless the user is rank 3+">
                  <input type="number" min="0" max="100" step="1" className="input-field input-md w-full" value={form.maxDiscountPct} onChange={set('maxDiscountPct')} />
                </Field>
              </div>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="checkbox-field mt-0.5"
                  checked={form.tipsEnabled}
                  onChange={setChecked('tipsEnabled')}
                />
                <div>
                  <div className="text-sm font-medium">Enable tips</div>
                  <div className="text-xs opacity-60">Show tip prompt during checkout</div>
                </div>
              </label>
              {form.tipsEnabled && (
                <Field label="Tip suggestions (%)" hint="Comma-separated percentages">
                  <input className="input-field input-md w-full sm:w-64" value={form.tipSuggestions} onChange={set('tipSuggestions')} placeholder="10,15,20" />
                </Field>
              )}
            </div>
          </div>
        )}

        {/* ── Loyalty ── */}
        {activeTab === 'loyalty' && (
          <div className="card-counter">
            <div className="space-y-5">
              <span className="eyebrow">Loyalty points</span>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Earn rate" hint="Points per whole currency unit spent">
                  <input type="number" min="0" max="1000" className="input-field input-md w-full" value={form.loyaltyEarnPerUnit} onChange={set('loyaltyEarnPerUnit')} />
                </Field>
                <Field label="Point value (cents)" hint="Value of one point when redeeming">
                  <input type="number" min="1" max="10000" className="input-field input-md w-full" value={form.loyaltyPointCents} onChange={set('loyaltyPointCents')} />
                </Field>
                <Field label="Minimum points to redeem" hint="Customers need this many points before redemption is allowed">
                  <input type="number" min="0" max="100000" className="input-field input-md w-full" value={form.loyaltyMinRedeem} onChange={set('loyaltyMinRedeem')} />
                </Field>
                <Field label="Max redemption (% of order)" hint="Cap on how much of an order can be paid with points (100 = full payment)">
                  <input type="number" min="0" max="100" step="1" className="input-field input-md w-full" value={form.loyaltyMaxRedemptionPct} onChange={set('loyaltyMaxRedemptionPct')} />
                </Field>
              </div>
              <Field label="Points expiry (days)" hint="0 = never expire. Points older than this are voided at redemption time.">
                <input type="number" min="0" max="3650" className="input-field input-md w-full sm:w-64" value={form.loyaltyExpiryDays} onChange={set('loyaltyExpiryDays')} />
              </Field>
            </div>
          </div>
        )}

        {/* ── Inventory ── */}
        {activeTab === 'inventory' && (
          <div className="card-counter">
            <div className="space-y-5">
              <span className="eyebrow">Inventory</span>
              <Field label="Low-stock alert threshold" hint="Global default — products below this trigger an alert">
                <input type="number" min="0" max="10000" className="input-field input-md w-full sm:w-64" value={form.lowStockAlertThreshold} onChange={set('lowStockAlertThreshold')} />
              </Field>
              <span className="eyebrow">Stock tracking</span>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="checkbox-field mt-0.5"
                  checked={form.inventoryStockMode === 'track'}
                  onChange={(e) => setForm((f) => ({ ...f, inventoryStockMode: e.target.checked ? 'track' : 'none' }))}
                />
                <div>
                  <div className="text-sm font-medium">Track stock levels</div>
                  <div className="text-xs opacity-60">When off, sales never decrement stock and inventory views act as reference lists only.</div>
                </div>
              </label>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="checkbox-field mt-0.5"
                  checked={form.inventoryRequireAdjustmentNote}
                  onChange={setChecked('inventoryRequireAdjustmentNote')}
                />
                <div>
                  <div className="text-sm font-medium">Require note on stock adjustments</div>
                  <div className="text-xs opacity-60">Staff must state a reason when manually changing stock counts.</div>
                </div>
              </label>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="checkbox-field mt-0.5"
                  checked={form.inventoryAutoReorder}
                  onChange={setChecked('inventoryAutoReorder')}
                />
                <div>
                  <div className="text-sm font-medium">Flag items for reorder</div>
                  <div className="text-xs opacity-60">Highlight products at or below their reorder point in inventory views.</div>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* ── Security ── */}
        {activeTab === 'security' && (
          <div className="space-y-5">
            <span className="eyebrow">Account security</span>
            {isOwner && (
              <div className="card-counter">
                <h2 className="text-display">Two-factor authentication</h2>
                <TwoFactorCard />
              </div>
            )}
            {isOwner && (
              <div className="card-counter">
                <h2 className="text-display">Daily email digest</h2>
                <DigestCard />
              </div>
            )}
            {!isOwner && (
              <div className="card-counter text-sm opacity-60">
                Security settings are only available to the business owner.
              </div>
            )}
          </div>
        )}

        {/* ── Integrations ── */}
        {activeTab === 'integrations' && (
          <div className="space-y-5">
            <span className="eyebrow">Connections</span>
            <div className="card-counter">
              {isOwner ? <PlatformCard /> : (
                <p className="text-sm opacity-60">Integrations are only available to the business owner.</p>
              )}
            </div>
          </div>
        )}

        {/* Save button (visible on all tabs) */}
        <div className="mt-6 flex justify-end">
          <button className={`btn-cta ${busy ? 'opacity-50 pointer-events-none' : ''}`} disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

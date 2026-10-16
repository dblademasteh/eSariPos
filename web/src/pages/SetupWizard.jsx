import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../state/AuthContext.jsx';
import { Field, useToast } from '../components/ui.jsx';
import {
  Building2, Banknote, Receipt, MapPin, Check,
  ChevronLeft, ChevronRight, Loader,
} from 'lucide-react';

const CURRENCIES = ['PHP', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'AED', 'INR', 'BRL', 'MXN', 'ZAR', 'SGD'];
const TIMEZONES = [
  'UTC',
  'Asia/Manila',
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Dubai',
  'US/Eastern', 'US/Central', 'US/Mountain', 'US/Pacific',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'Australia/Sydney', 'Pacific/Auckland',
  'America/Sao_Paulo', 'America/Mexico_City', 'Africa/Johannesburg',
];

const STEPS = [
  { id: 'business', label: 'Business Info', icon: Building2 },
  { id: 'financial', label: 'Financial', icon: Banknote },
  { id: 'receipt', label: 'Receipt', icon: Receipt },
  { id: 'location', label: 'Location', icon: MapPin },
  { id: 'done', label: 'Done', icon: Check },
];

function ProgressBar({ current, total }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-colors ${
            i <= current ? 'bg-accent' : 'bg-panel'
          }`}
        />
      ))}
    </div>
  );
}

function StepBusiness({ data, onChange, onNext }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Business Information</h2>
        <p className="mt-1 text-sm opacity-60">Tell us about your store.</p>
      </div>
      <Field label="Business name">
        <input
          className="input-field input-md w-full"
          value={data.businessName}
          onChange={(e) => onChange({ businessName: e.target.value })}
          required
        />
      </Field>
      <Field label="Address">
        <input
          className="input-field input-md w-full"
          placeholder="123 Main St, Manila"
          value={data.address}
          onChange={(e) => onChange({ address: e.target.value })}
        />
      </Field>
      <Field label="Phone">
        <input
          className="input-field input-md w-full"
          placeholder="+63 917 123 4567"
          value={data.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
        />
      </Field>
      <button className="btn-cta btn-block" onClick={onNext}>
        Next <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function StepFinancial({ data, onChange, onNext, onBack }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Financial Settings</h2>
        <p className="mt-1 text-sm opacity-60">Configure currency, tax, and timezone.</p>
      </div>
      <Field label="Currency">
        <select
          className="select-field input-md w-full"
          value={data.currency}
          onChange={(e) => onChange({ currency: e.target.value })}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="Tax rate (%)">
        <input
          type="number"
          step="0.01"
          min="0"
          max="100"
          className="input-field input-md w-full"
          value={data.taxRate}
          onChange={(e) => onChange({ taxRate: e.target.value })}
        />
      </Field>
      <Field label="Timezone">
        <select
          className="select-field input-md w-full"
          value={data.timezone}
          onChange={(e) => onChange({ timezone: e.target.value })}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
      </Field>
      <label className="checkbox-field cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="checkbox-field"
            checked={data.taxInclusive}
            onChange={(e) => onChange({ taxInclusive: e.target.checked })}
          />
          <span className="font-medium text-ink">Prices include tax (tax-inclusive)</span>
        </label>
      <div className="flex gap-2">
        <button className="btn-ghost" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <button className="btn-cta flex-1" onClick={onNext}>
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function StepReceipt({ data, onChange, onNext, onBack }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Receipt & BIR Compliance</h2>
        <p className="mt-1 text-sm opacity-60">Set up your official receipt details.</p>
      </div>
      <Field label="Receipt header">
        <input
          className="input-field input-md w-full"
          placeholder="Your store name and tagline"
          value={data.receiptHeader}
          onChange={(e) => onChange({ receiptHeader: e.target.value })}
        />
      </Field>
      <Field label="Receipt footer">
        <input
          className="input-field input-md w-full"
          placeholder="Thank you for your purchase!"
          value={data.receiptFooter}
          onChange={(e) => onChange({ receiptFooter: e.target.value })}
        />
      </Field>
      <div className="divider text-xs opacity-40">BIR Compliance (Philippines)</div>
      <Field label="TIN (Tax Identification Number)">
        <input
          className="input input-md w-full font-mono"
          placeholder="123-456-789-000"
          value={data.tin}
          onChange={(e) => onChange({ tin: e.target.value })}
        />
      </Field>
      <Field label="BIR Accreditation No.">
        <input
          className="input input-md w-full font-mono"
          placeholder="000000000000"
          value={data.birAccreditationNo}
          onChange={(e) => onChange({ birAccreditationNo: e.target.value })}
        />
      </Field>
      <Field label="Machine Serial No.">
        <input
          className="input input-md w-full font-mono"
          placeholder="0000000000"
          value={data.machineSerialNo}
          onChange={(e) => onChange({ machineSerialNo: e.target.value })}
        />
      </Field>
      <div className="flex gap-2">
        <button className="btn-ghost" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <button className="btn-cta flex-1" onClick={onNext}>
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function StepLocation({ data, onChange, onNext, onBack }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Store Location</h2>
        <p className="mt-1 text-sm opacity-60">Create your first stock location.</p>
      </div>
      <Field label="Location name">
        <input
          className="input-field input-md w-full"
          placeholder="Main store"
          value={data.locationName}
          onChange={(e) => onChange({ locationName: e.target.value })}
        />
      </Field>
      <Field label="Address (optional)">
        <input
          className="input-field input-md w-full"
          placeholder="123 Main St, Manila"
          value={data.locationAddress}
          onChange={(e) => onChange({ locationAddress: e.target.value })}
        />
      </Field>
      <div className="flex gap-2">
        <button className="btn-ghost" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <button className="btn-cta flex-1" onClick={onNext}>
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function StepDone({ onGoToDashboard }) {
  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent-dim">
        <Check className="h-8 w-8 text-accent" />
      </div>
      <div>
        <h2 className="text-xl font-bold">You're all set!</h2>
        <p className="mt-1 text-sm opacity-60">
          Your store is configured and ready to go.
        </p>
      </div>
      <div className="rounded-xl bg-panel p-4 text-left text-sm">
        <p className="mb-2 font-medium">Next steps:</p>
        <ul className="space-y-1 opacity-70">
          <li>• Add your first products</li>
          <li>• Set up staff accounts</li>
          <li>• Start making sales</li>
        </ul>
      </div>
      <button className="btn-cta btn-block" onClick={onGoToDashboard}>
        Go to Dashboard
      </button>
    </div>
  );
}

export default function SetupWizard() {
  const { tenant, refreshMe } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState({
    businessName: tenant?.name ?? '',
    address: tenant?.address ?? '',
    phone: tenant?.phone ?? '',
    currency: 'PHP',
    taxRate: '12',
    timezone: 'Asia/Manila',
    taxInclusive: true,
    receiptHeader: tenant?.name ?? '',
    receiptFooter: 'Thank you for your purchase!',
    tin: '',
    birAccreditationNo: '',
    machineSerialNo: '',
    locationName: 'Main store',
    locationAddress: '',
  });

  const update = (patch) => setData((d) => ({ ...d, ...patch }));

  async function saveSettings() {
    await api('/settings', {
      method: 'PATCH',
      body: {
        name: data.businessName,
        address: data.address || null,
        phone: data.phone || null,
        currency: data.currency,
        taxRate: Number(data.taxRate),
        timezone: data.timezone,
        taxInclusive: data.taxInclusive,
        receiptHeader: data.receiptHeader || null,
        receiptFooter: data.receiptFooter || null,
        tin: data.tin || null,
        birAccreditationNo: data.birAccreditationNo || null,
        machineSerialNo: data.machineSerialNo || null,
      },
    });
  }

  async function createLocation() {
    if (!data.locationName.trim()) return;
    await api('/locations', {
      method: 'POST',
      body: { name: data.locationName, address: data.locationAddress || null },
    });
  }

  async function markComplete() {
    await api('/settings', {
      method: 'PATCH',
      body: { setupCompleted: true },
    });
    await refreshMe();
  }

  async function handleNext() {
    setBusy(true);
    try {
      if (step === 0) {
        await saveSettings();
      } else if (step === 1) {
        await saveSettings();
      } else if (step === 2) {
        await saveSettings();
      } else if (step === 3) {
        await createLocation();
      } else if (step === 4) {
        await markComplete();
      }
      setStep((s) => s + 1);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleBack() {
    setStep((s) => s - 1);
  }

  function goToDashboard() {
    setBusy(true);
    markComplete()
      .then(() => navigate('/'))
      .catch((err) => {
        toast.error(err.message);
        setBusy(false);
      });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-panel p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="receipt-head text-center">
          <div className="receipt-meta justify-center">
            <span className="font-bold">{tenant?.name}</span>
            <span className="dot" aria-hidden="true"></span>
            <span>{new Date().toLocaleDateString()}</span>
          </div>
          <h1 className="text-2xl font-bold">Set up your store</h1>
          <p className="mt-1 text-sm opacity-60">
            Step {step + 1} of {STEPS.length}
          </p>
        </div>

        {/* Progress */}
        <ProgressBar current={step} total={STEPS.length} />

        {/* Step indicator */}
        <div className="flex justify-center gap-4">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={`flex items-center gap-1.5 text-xs ${
                i === step ? 'text-accent font-medium' : i < step ? 'text-accent' : 'opacity-40'
              }`}
            >
              {i < step ? (
                <Check className="h-3 w-3" />
              ) : (
                <s.icon className="h-3 w-3" />
              )}
              <span className="hidden sm:inline">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="rounded-lg bg-paper p-6">
          {step === 0 && <StepBusiness data={data} onChange={update} onNext={handleNext} />}
          {step === 1 && <StepFinancial data={data} onChange={update} onNext={handleNext} onBack={handleBack} />}
          {step === 2 && <StepReceipt data={data} onChange={update} onNext={handleNext} onBack={handleBack} />}
          {step === 3 && <StepLocation data={data} onChange={update} onNext={handleNext} onBack={handleBack} />}
          {step === 4 && <StepDone onGoToDashboard={goToDashboard} />}

          {step < 4 && busy && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm opacity-60">
              <Loader className="h-4 w-4 spin" /> Saving...
            </div>
          )}
        </div>

        {/* Skip */}
        {step < 4 && (
          <button
            className="btn-ghost btn-sm btn-block opacity-50"
            onClick={() => setStep(4)}
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}

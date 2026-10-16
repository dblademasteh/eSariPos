import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../state/AuthContext.jsx';
import { Field, useToast } from '../components/ui.jsx';

const DEMO = { slug: 'demo', email: 'demo@novapos.dev', password: 'demo1234' };

function Logo({ className = '' }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <rect width="40" height="40" rx="10" fill="currentColor" className="text-white" />
      <path
        d="M10 28V12h4.5l3.5 10 3.5-10H25v16h-3v-11l-3.5 10h-2L13 17v11h-3z"
        fill="currentColor"
        className="text-white"
      />
    </svg>
  );
}

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState('signin');
  const [busy, setBusy] = useState(false);
  const [twoFactor, setTwoFactor] = useState(null);
  const [code, setCode] = useState('');
  const [form, setForm] = useState({
    slug: '',
    email: '',
    password: '',
    businessName: '',
    name: '',
  });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const data =
        mode === 'signin'
          ? await api('/auth/login', { method: 'POST', body: form })
          : await api('/auth/register', {
              method: 'POST',
              body: {
                businessName: form.businessName,
                slug: form.slug,
                name: form.name,
                email: form.email,
                password: form.password,
              },
            });
      if (data.twoFactorRequired) {
        setTwoFactor(data.preToken);
        return;
      }
      login(data);
      toast.success(mode === 'signin' ? `Welcome back, ${data.user.name.split(' ')[0]}!` : 'Business created — welcome aboard!');
      navigate(mode === 'signin' && data.tenant?.setupCompleted ? '/' : '/setup');
    } catch (err) {
      const detail = Array.isArray(err.details) && err.details.length
        ? err.details[0].message
        : err.message;
      toast.error(detail);
    } finally {
      setBusy(false);
    }
  }

  async function submit2fa(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await api('/auth/verify2fa', {
        method: 'POST',
        body: { preToken: twoFactor, code },
      });
      login(data);
      toast.success(`Welcome back, ${data.user.name.split(' ')[0]}!`);
      navigate('/');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-paper">
      {/* Left panel — brand thesis */}
      <div className="hidden w-[50%] flex-col justify-between bg-accent text-white lg:flex">
        <div className="p-10">
          <div className="flex items-center gap-3 mb-10">
            <Logo className="h-9 w-9" />
            <span className="text-xl font-bold tracking-tight">eSariPOS</span>
          </div>

          <h2 className="text-3xl font-bold leading-[1.15] tracking-tight mb-4">
            Register behind the counter.
          </h2>
          <p className="text-lg text-white/90 leading-relaxed max-w-md mb-8">
            eSariPOS is the register behind the counter — ring up sales,
            track stock, and print official receipts for your sari-sari store.
          </p>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">₱</span>
              <span>Peso-priced, tax-aware checkout</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">BIR</span>
              <span>Official receipts with TIN &amp; accreditation no.</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">📱</span>
              <span>Works offline — syncs when back online</span>
            </div>
          </div>
        </div>

        <div className="p-10 border-t border-white/20">
          <p className="text-xs text-white/70">&copy; {new Date().getFullYear()} eSariPOS. Built for Philippine sari-sari stores.</p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex w-full items-center justify-center bg-white p-6 sm:p-12 lg:w-[50%]">
        <div className="w-full max-w-md space-y-8">
          {/* Mobile brand */}
          <div className="text-center lg:hidden">
            <Logo className="mx-auto mb-4 h-10 w-10" />
            <h1 className="text-xl font-bold tracking-tight text-ink">eSariPOS</h1>
            <p className="mt-1 text-sm text-mute">Point of sale for sari-sari stores</p>
          </div>

          {/* Heading */}
          <div>
            <span className="eyebrow text-accent">eSariPOS · {mode === 'signin' ? 'Sign in' : 'New business'}</span>
            <h2 className="text-2xl font-bold tracking-tight text-ink">
              {mode === 'signin' ? 'Welcome back' : 'Get started'}
            </h2>
            <p className="mt-1.5 text-sm text-mute">
              {mode === 'signin'
                ? 'Sign in to your store counter'
                : 'Create your business account in seconds'}
            </p>
          </div>

          {/* Mode toggle */}
          <div className="flex rounded-lg bg-panel p-1">
            <button
              className={`flex-1 rounded-md py-2.5 text-sm font-semibold transition-colors ${
                mode === 'signin'
                  ? 'bg-paper text-ink border border-line'
                  : 'text-mute hover:text-ink/80'
              }`}
              onClick={() => setMode('signin')}
            >
              Sign in
            </button>
            <button
              className={`flex-1 rounded-md py-2.5 text-sm font-semibold transition-colors ${
                mode === 'signup'
                  ? 'bg-paper text-ink border border-line'
                  : 'text-mute hover:text-ink/80'
              }`}
              onClick={() => setMode('signup')}
            >
              Create account
            </button>
          </div>

          {twoFactor ? (
            <form onSubmit={submit2fa} className="space-y-5">
              <div className="rounded-lg border border-warn/20 bg-warn-dim p-5 border-warn">
                <div className="flex items-start gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="mt-0.5 h-5 w-5 shrink-0 text-warn">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25-2.25v6.75a2.25 2.25 0 002.25-2.25z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-ink">Two-factor authentication</p>
                    <p className="mt-0.5 text-xs text-mute">Enter the 6-digit code from your authenticator app.</p>
                  </div>
                </div>
              </div>
              <Field label="Verification code">
                <input
                  className="input-field input-lg w-full text-center font-data text-2xl tracking-[0.5em] text-ink"
                  placeholder="000000"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  required
                  autoFocus
                  autoComplete="off"
                />
              </Field>
              <button className={`btn-cta btn-block ${busy ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={busy || code.length !== 6}>
                Verify & sign in
              </button>
              <button type="button" className="btn-ghost btn-block btn-xs mt-3" onClick={() => setTwoFactor(null)}>
                Back to sign in
              </button>
            </form>
          ) : (
          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <Field label="Business name">
                  <input
                    className="input-field input-md w-full text-ink"
                    placeholder="Acme Coffee Co."
                    value={form.businessName}
                    onChange={set('businessName')}
                    required
                    autoComplete="off"
                  />
                </Field>
                <Field label="Business ID" hint="Lowercase letters, numbers, dashes">
                  <input
                    className="input-field input-md w-full font-data text-ink"
                    placeholder="acme-coffee"
                    pattern="[a-z0-9\-]{2,40}"
                    value={form.slug}
                    onChange={set('slug')}
                    required
                    autoComplete="off"
                  />
                </Field>
                <Field label="Your name">
                  <input
                    className="input-field input-md w-full text-ink"
                    placeholder="Jane Doe"
                    value={form.name}
                    onChange={set('name')}
                    required
                    autoComplete="name"
                  />
                </Field>
              </>
            )}

            {mode === 'signin' && (
              <Field label="Business ID">
                <input
                  className="input-field input-md w-full font-data text-ink"
                  placeholder="acme-coffee"
                  pattern="[a-z0-9\-]{2,40}"
                  value={form.slug}
                  onChange={set('slug')}
                  required
                  autoComplete="off"
                />
              </Field>
            )}

            <Field label="Email">
              <input
                type="email"
                className="input-field input-md w-full text-ink"
                placeholder="you@store.com"
                value={form.email}
                onChange={set('email')}
                required
                autoComplete="email"
              />
            </Field>

            <Field label="Password" hint={mode === 'signup' ? 'Min 8 characters' : undefined}>
              <input
                type="password"
                className="input-field input-md w-full text-ink"
                placeholder="Password…"
                minLength={mode === 'signup' ? 8 : undefined}
                value={form.password}
                onChange={set('password')}
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </Field>

            <button className={`btn-cta btn-block ${busy ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={busy}>
              {mode === 'signin' ? 'Sign in' : 'Create business'}
            </button>
          </form>
          )}

          {/* Demo hint */}
          {mode === 'signin' && !twoFactor && (
            <div className="rounded-lg border border-line bg-panel p-4 border-line">
              <div className="flex items-center justify-between">
                <div className="text-xs leading-relaxed">
                  <span className="font-medium text-ink">Try the demo store</span>
                  <span className="mt-0.5 block font-data text-mute">demo &middot; demo@novapos.dev &middot; demo1234</span>
                </div>
                <button
                  type="button"
                  className="btn-ghost btn-xs"
                  onClick={() => setForm((f) => ({ ...f, ...DEMO }))}
                >
                  Fill
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

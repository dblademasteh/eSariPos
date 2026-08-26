import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../state/AuthContext.jsx';
import { Field, useToast } from '../components/ui.jsx';

const DEMO = { slug: 'demo', email: 'demo@novapos.dev', password: 'demo1234' };

function Logo({ className = '' }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <rect width="40" height="40" rx="10" fill="currentColor" className="text-primary" />
      <path
        d="M10 28V12h4.5l3.5 10 3.5-10H25v16h-3v-11l-3.5 10h-2L13 17v11h-3z"
        fill="currentColor"
        className="text-primary-content"
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
    <div className="flex min-h-screen">
      {/* ── Left panel — brand ── */}
      <div className="hidden w-[55%] flex-col justify-between bg-gradient-to-br from-neutral via-neutral to-base-300 p-12 text-neutral-content lg:flex">
        {/* Top */}
        <div className="flex items-center gap-3">
          <Logo className="h-10 w-10" />
          <span className="text-xl font-bold tracking-tight">eSariPOS</span>
        </div>

        {/* Center content */}
        <div className="space-y-10">
          <div className="space-y-4">
            <h2 className="text-4xl font-bold leading-[1.15] tracking-tight">
              Run your store<br />with confidence.
            </h2>
            <p className="max-w-md text-base leading-relaxed opacity-60">
              Inventory management, staff scheduling, sales analytics and BIR compliance —
              everything you need in a single platform.
            </p>
          </div>

          {/* Feature cards */}
          <div className="grid max-w-md grid-cols-2 gap-4">
            {[
              { icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z', label: 'Multi-tenant', desc: 'Unlimited stores' },
              { icon: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z', label: 'BIR Compliant', desc: 'Official receipts' },
              { icon: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z', label: 'Real-time', desc: 'Live analytics' },
              { icon: 'M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z', label: 'Secure', desc: '2FA & encryption' },
            ].map((f) => (
              <div key={f.label} className="flex items-start gap-3 rounded-xl bg-white/5 p-3 backdrop-blur-sm">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="mt-0.5 h-5 w-5 shrink-0 opacity-70">
                  <path strokeLinecap="round" strokeLinejoin="round" d={f.icon} />
                </svg>
                <div>
                  <div className="text-sm font-semibold">{f.label}</div>
                  <div className="text-xs opacity-50">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom */}
        <p className="text-xs opacity-30">&copy; {new Date().getFullYear()} eSariPOS. All rights reserved.</p>
      </div>

      {/* ── Right panel — form ── */}
      <div className="flex w-full items-center justify-center bg-base-100 p-6 sm:p-10 lg:w-[45%]">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile brand */}
          <div className="text-center lg:hidden">
            <Logo className="mx-auto mb-4 h-12 w-12" />
            <h1 className="text-2xl font-bold tracking-tight">eSariPOS</h1>
            <p className="mt-1 text-sm opacity-50">Multi-store point of sale</p>
          </div>

          {/* Heading */}
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              {mode === 'signin' ? 'Welcome back' : 'Get started'}
            </h2>
            <p className="mt-1.5 text-sm opacity-50">
              {mode === 'signin'
                ? 'Sign in to your eSariPOS dashboard'
                : 'Create your business account in seconds'}
            </p>
          </div>

          {/* Mode toggle */}
          <div className="flex rounded-xl bg-base-200 p-1">
            <button
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all duration-200 ${
                mode === 'signin'
                  ? 'bg-base-100 text-base-content shadow-sm'
                  : 'text-base-content/50 hover:text-base-content/70'
              }`}
              onClick={() => setMode('signin')}
            >
              Sign in
            </button>
            <button
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all duration-200 ${
                mode === 'signup'
                  ? 'bg-base-100 text-base-content shadow-sm'
                  : 'text-base-content/50 hover:text-base-content/70'
              }`}
              onClick={() => setMode('signup')}
            >
              Create account
            </button>
          </div>

          {twoFactor ? (
            <form onSubmit={submit2fa} className="space-y-5">
              <div className="rounded-xl border border-info/20 bg-info/5 p-4">
                <div className="flex items-start gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="mt-0.5 h-5 w-5 shrink-0 text-info">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium">Two-factor authentication</p>
                    <p className="mt-0.5 text-xs opacity-60">Enter the 6-digit code from your authenticator app.</p>
                  </div>
                </div>
              </div>
              <Field label="Verification code">
                <input
                  className="input input-lg w-full text-center font-mono text-2xl tracking-[0.5em]"
                  placeholder="000000"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  required
                  autoFocus
                />
              </Field>
              <button className={`btn btn-primary btn-block ${busy ? 'loading' : ''}`} disabled={busy || code.length !== 6}>
                Verify & sign in
              </button>
              <button type="button" className="btn btn-ghost btn-sm btn-block" onClick={() => setTwoFactor(null)}>
                Back to sign in
              </button>
            </form>
          ) : (
          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <Field label="Business name">
                  <input
                    className="input input-md w-full"
                    placeholder="Acme Coffee Co."
                    value={form.businessName}
                    onChange={set('businessName')}
                    required
                  />
                </Field>
                <Field label="Business ID" hint="Lowercase letters, numbers, dashes">
                  <input
                    className="input input-md w-full font-mono"
                    placeholder="acme-coffee"
                    pattern="[a-z0-9\-]{2,40}"
                    value={form.slug}
                    onChange={set('slug')}
                    required
                  />
                </Field>
                <Field label="Your name">
                  <input
                    className="input input-md w-full"
                    placeholder="Jane Doe"
                    value={form.name}
                    onChange={set('name')}
                    required
                  />
                </Field>
              </>
            )}

            {mode === 'signin' && (
              <Field label="Business ID">
                <input
                  className="input input-md w-full font-mono"
                  placeholder="acme-coffee"
                  pattern="[a-z0-9\-]{2,40}"
                  value={form.slug}
                  onChange={set('slug')}
                  required
                />
              </Field>
            )}

            <Field label="Email">
              <input
                type="email"
                className="input input-md w-full"
                placeholder="you@store.com"
                value={form.email}
                onChange={set('email')}
                required
              />
            </Field>

            <Field label="Password" hint={mode === 'signup' ? 'Min 8 characters' : undefined}>
              <input
                type="password"
                className="input input-md w-full"
                placeholder="••••••••"
                minLength={mode === 'signup' ? 8 : undefined}
                value={form.password}
                onChange={set('password')}
                required
              />
            </Field>

            <button className={`btn btn-primary btn-block ${busy ? 'loading' : ''}`} disabled={busy}>
              {mode === 'signin' ? 'Sign in' : 'Create business'}
            </button>
          </form>
          )}

          {/* Demo hint */}
          {mode === 'signin' && !twoFactor && (
            <div className="rounded-xl border border-base-300 bg-base-200/50 p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs leading-relaxed">
                  <span className="font-medium text-base-content">Try the demo store</span>
                  <span className="mt-0.5 block font-mono opacity-50">demo &middot; demo@novapos.dev &middot; demo1234</span>
                </div>
                <button
                  type="button"
                  className="btn btn-xs btn-outline"
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

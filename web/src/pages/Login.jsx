import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../state/AuthContext.jsx';
import { Field, useToast } from '../components/ui.jsx';

const DEMO = { slug: 'demo', email: 'demo@novapos.dev', password: 'demo1234' };

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState('signin');
  const [busy, setBusy] = useState(false);
  const [twoFactor, setTwoFactor] = useState(null); // preToken from the server
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
      toast.success(mode === 'signin' ? `Welcome back, ${data.user.name.split(' ')[0]}!` : 'Business created - welcome aboard!');
      navigate('/');
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
    <div className="grid min-h-screen place-items-center bg-base-200 p-4">
      <div className="card w-full max-w-md bg-base-100 shadow-xl">
        <div className="card-body gap-5">
          <div className="text-center">
            <div className="text-4xl">🧾</div>
            <h1 className="mt-2 text-2xl font-black tracking-tight">NovaPOS</h1>
            <p className="text-sm opacity-60">Multi-store point of sale</p>
          </div>

          <div role="tablist" className="join mx-auto">
            <button
              className={`btn btn-sm join-item ${mode === 'signin' ? 'btn-primary' : ''}`}
              onClick={() => setMode('signin')}
            >
              Sign in
            </button>
            <button
              className={`btn btn-sm join-item ${mode === 'signup' ? 'btn-primary' : ''}`}
              onClick={() => setMode('signup')}
            >
              New business
            </button>
          </div>

          {twoFactor ? (
            <form onSubmit={submit2fa} className="space-y-3">
              <div className="alert alert-info text-sm">
                <span>Two-factor is enabled for this account. Enter the 6-digit code from your authenticator app.</span>
              </div>
              <Field label="Authentication code">
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
              <button className={`btn btn-primary w-full ${busy ? 'loading' : ''}`} disabled={busy || code.length !== 6}>
                Verify & sign in
              </button>
              <button type="button" className="btn btn-ghost btn-sm w-full" onClick={() => setTwoFactor(null)}>
                Back
              </button>
            </form>
          ) : (
          <form onSubmit={submit} className="space-y-3">
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
                <Field label="Business ID" hint="Used at sign-in. Lowercase letters, numbers, dashes.">
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
                  placeholder="demo"
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

            <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters' : undefined}>
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

            <button className={`btn btn-primary w-full ${busy ? 'loading' : ''}`} disabled={busy}>
              {mode === 'signin' ? 'Sign in' : 'Create business'}
            </button>
          </form>
          )}

          {mode === 'signin' && !twoFactor && (
            <div className="alert text-sm">
              <span className="flex-1">
                Try the demo store — <b>demo</b> / demo@novapos.dev / demo1234
              </span>
              <button
                type="button"
                className="btn btn-xs btn-outline"
                onClick={() => setForm((f) => ({ ...f, ...DEMO }))}
              >
                Fill
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

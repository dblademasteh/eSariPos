import { useEffect, useState } from 'react';
import { makeMoney } from '../lib/format.js';

// Customer-facing display: open /display on a second screen. The register
// broadcasts cart changes over a BroadcastChannel - no server round-trips.
export default function Display() {
  const [state, setState] = useState({ lines: [], total: 0, currency: 'USD', message: 'Welcome!' });

  useEffect(() => {
    const stored = localStorage.getItem('novapos.profile');
    if (stored) {
      try {
        const tenant = JSON.parse(stored)?.tenant;
        if (tenant?.currency) {
          setState((s) => ({ ...s, currency: tenant.currency, message: tenant.name ?? s.message }));
        }
      } catch {}
    }
    const ch = new BroadcastChannel('novapos-register');
    ch.onmessage = (e) => {
      const d = e.data ?? {};
      if (d.type === 'cart') {
        setState((s) => ({
          ...s,
          lines: d.lines ?? [],
          total: d.total ?? 0,
          message: d.thanks ? 'Thank you! See you soon 👋' : s.message,
        }));
      }
      if (d.type === 'hello' && d.currency) setState((s) => ({ ...s, currency: d.currency }));
    };
    return () => ch.close();
  }, []);

  const money = makeMoney(state.currency);

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-white">
      <header className="border-b border-neutral-800 px-8 py-4 text-sm uppercase tracking-[0.3em] text-neutral-400">
        eSariPOS · customer display
      </header>
      <main className="flex min-h-0 flex-1 flex-col justify-between p-10">
        <ul className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-2">
          {state.lines.length === 0 && (
            <li className="text-3xl font-light text-neutral-500">{state.message}</li>
          )}
          {state.lines.map((l, i) => (
            <li key={i} className="flex items-baseline gap-6 text-3xl">
              <span className="w-16 text-neutral-400">{l.qty}×</span>
              <span className="flex-1 truncate">{l.name}</span>
              <span className="font-semibold">{money(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-8 border-t border-neutral-800 pt-6">
          <div className="text-sm uppercase tracking-widest text-neutral-500">Total</div>
          <div className="text-7xl font-black">{money(state.total)}</div>
        </div>
      </main>
    </div>
  );
}

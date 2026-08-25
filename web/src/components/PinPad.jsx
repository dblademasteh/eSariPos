import { useState } from 'react';
import { Check, Delete } from 'lucide-react';

// Generic numeric PIN pad (4-8 digits). Used for staff handover and setting
// one's own register PIN.
export default function PinPad({ title, onDone, onCancel, confirmLabel = 'Confirm' }) {
  const [digits, setDigits] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function press(d) {
    setError('');
    setDigits((v) => (v.length >= 8 ? v : v + d));
  }

  async function confirm() {
    if (digits.length < 4) {
      setError('PIN must be at least 4 digits');
      return;
    }
    setBusy(true);
    try {
      await onDone(digits);
      setDigits('');
      setError('');
    } catch (err) {
      setDigits('');
      setError(err.message || 'Failed');
      throw err;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" data-pin-pad>
      <h3 className="text-center text-lg font-bold">{title}</h3>
      <div className="flex justify-center gap-2 py-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <span key={i} className={`h-3 w-3 rounded-full ${i < digits.length ? 'bg-primary' : 'bg-base-300'}`} />
        ))}
      </div>
      {error && <p className="text-center text-sm text-error">{error}</p>}
      <div className="mx-auto grid max-w-[240px] grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="btn btn-lg" onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button type="button" className="btn btn-ghost btn-lg" onClick={() => setDigits((v) => v.slice(0, -1))}>
          <Delete className="h-5 w-5" />
        </button>
        <button type="button" className="btn btn-lg" onClick={() => press('0')}>
          0
        </button>
        <button type="button" className={`btn btn-primary btn-lg ${busy ? 'loading' : ''}`} onClick={confirm}>
          {confirmLabel}
        </button>
      </div>
      {onCancel && (
        <div className="text-center">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

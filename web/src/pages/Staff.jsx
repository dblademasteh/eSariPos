import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { fmtDateTime } from '../lib/format.js';
import { downloadCsv } from '../lib/export.js';
import { PERM_KEYS, PERM_LABELS } from '../lib/perms.js';
import { useAuth } from '../state/AuthContext.jsx';
import { Field, Modal, RoleBadge, Spinner, useToast } from '../components/ui.jsx';
import { Check, Pencil, Hash, Download } from 'lucide-react';
import PinPad from '../components/PinPad.jsx';

export default function Staff() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [staff, setStaff] = useState(null);
  const [editing, setEditing] = useState(null);
  const [pinFor, setPinFor] = useState(null);
  const [report, setReport] = useState(null);

  async function load() {
    try {
      const [list, rep] = await Promise.all([
        api('/staff'),
        api('/timeclock/report').catch(() => null),
      ]);
      setStaff(list);
      setReport(rep);
    } catch (err) {
      toast.error(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="receipt-head">
        <div className="receipt-meta">
          <span className="font-bold">eSariPOS</span>
          <span className="dot" aria-hidden="true"></span>
          <span>{new Date().toLocaleDateString()}</span>
        </div>
        <h1 className="text-xl font-bold">Staff</h1>
        <p className="text-sm opacity-60">People who can sign in to this business</p>
        <button className="btn-cta btn-sm ml-auto mt-2" onClick={() => setEditing({})}>
          + Add staff
        </button>
      </div>

      {!staff ? (
        <Spinner />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-paper">
          <table className="table-counter">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Permissions</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className={!s.isActive ? 'opacity-50' : ''}>
                  <td className="font-medium">
                    {s.name}
                    {s.id === me.id && <span className="ml-2 badge-pill badge-sm">you</span>}
                  </td>
                  <td>{s.email}</td>
                  <td>
                    <RoleBadge role={s.role} />
                    {s.totpEnabled && <span className="badge-pill badge-sm accent ml-1">2FA</span>}
                  </td>
                  <td>
                    <span className="text-xs opacity-70">
                      {s.perms.length ? s.perms.join(', ') : 'sell only'}
                      {s.hasPin && <><span className="mx-1">·</span>PIN <Check className="inline h-3 w-3 text-accent" /></>}
                    </span>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      className="toggle-field toggle-sm"
                      checked={s.isActive}
                      disabled={s.id === me.id}
                      onChange={async (e) => {
                        try {
                          await api(`/staff/${s.id}`, {
                            method: 'PATCH',
                            body: { isActive: e.target.checked },
                          });
                          load();
                        } catch (err) {
                          toast.error(err.message);
                        }
                      }}
                    />
                  </td>
                  <td className="text-right">
                    <button aria-label={`Edit ${s.name}`} className="btn-ghost btn-xs" onClick={() => setEditing(s)}>
                       <Pencil className="h-4 w-4" />
                    </button>
                    {!s.hasPin && (
                      <button
                        aria-label={`Set register PIN for ${s.name}`}
                        className="btn-ghost btn-xs"
                        title="Set this member's register PIN"
                        onClick={async () => {
                          const pin = window.prompt(`4-8 digit PIN for ${s.name} (blank to cancel)`);
                          if (!pin) return;
                          try {
                            await api(`/staff/${s.id}`, { method: 'PATCH', body: { pin } });
                            toast.success('PIN set');
                            load();
                          } catch (err) {
                            toast.error(err.message);
                          }
                        }}
                      >
                        <Hash className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report && report.shifts.length > 0 && (
        <div className="rounded-lg bg-paper p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">Time clock · last 30 days</h2>
            <button
              className="btn-outline btn-sm"
              onClick={() =>
                downloadCsv(`timeclock-30d`, [
                  { key: 'staffName', label: 'Staff' },
                  { key: 'clockIn', label: 'Clock in', value: (s) => new Date(s.clockIn).toLocaleString() },
                  { key: 'clockOut', label: 'Clock out', value: (s) => (s.clockOut ? new Date(s.clockOut).toLocaleString() : '—') },
                  { key: 'hours', label: 'Hours' },
                ], report.shifts)
              }
            >
              <Download className="mr-1 inline h-4 w-4" /> CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="table-counter table-sm">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Shifts</th>
                  <th className="text-right">Hours</th>
                  <th>Last shift</th>
                </tr>
              </thead>
              <tbody>
                {report.totals.map((t) => {
                  const last = report.shifts.find((s) => s.staffName === t.name);
                  return (
                    <tr key={t.userId ?? t.name}>
                      <td className="font-medium">{t.name}</td>
                      <td>{t.shifts}</td>
                      <td className="text-right font-mono">{t.hours}</td>
                       <td className="text-xs opacity-60">{last ? `${fmtDateTime(last.clockIn)} -> ${fmtDateTime(last.clockOut)}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <StaffModal
        open={!!editing}
        staff={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
        onPin={(member) => {
          setEditing(null);
          setPinFor(member);
        }}
      />

      {pinFor && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setPinFor(null)}>
          <div className="modal-box max-w-sm">
            <PinPad
              title={`Register PIN · ${pinFor.name}`}
              confirmLabel="Save"
              onDone={async (pin) => {
                try {
                  await api(`/staff/${pinFor.id}`, { method: 'PATCH', body: { pin } });
                  toast.success('PIN set');
                  setPinFor(null);
                  load();
                } catch (err) {
                  err.message && toast.error(err.message);
                  throw err;
                }
              }}
              onCancel={() => setPinFor(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function StaffModal({ open, staff, onClose, onSaved, onPin }) {
  const toast = useToast();
  const isNew = !staff?.id;
  const [form, setForm] = useState(null);
  const [perms, setPerms] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        name: staff?.name ?? '',
        email: staff?.email ?? '',
        password: '',
        role: staff?.role ?? 'cashier',
        pin: '',
      });
      setPerms(Object.fromEntries(PERM_KEYS.map((k) => [k, Boolean(staff?.perms?.includes(k))])));
    }
  }, [open, staff]);

  if (!open || !form) return null;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (isNew) {
        await api('/staff', {
          method: 'POST',
          body: { ...form, password: form.password, permissions: perms },
        });
      } else {
        const patch = { name: form.name, role: form.role, permissions: perms };
        if (form.password) patch.password = form.password;
        if (form.pin) patch.pin = form.pin;
        await api(`/staff/${staff.id}`, { method: 'PATCH', body: patch });
      }
      toast.success(isNew ? `${form.name} can now sign in` : 'Saved');
      onSaved();
    } catch (err) {
      const detail = Array.isArray(err.details) && err.details.length ? err.details[0].message : err.message;
      toast.error(detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'Add staff member' : `Edit ${staff.name}`} wide>
      <form onSubmit={save} className="space-y-3">
        <Field label="Name">
          <input className="input-field input-md w-full" value={form.name} onChange={set('name')} required autoFocus />
        </Field>
        <Field label="Email">
          <input type="email" className="input-field input-md w-full" value={form.email} onChange={set('email')} required disabled={!isNew} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role" hint="Managers can refund and edit products. Cashiers sell.">
            <select className="select-field input-md w-full" value={form.role} onChange={set('role')}>
              <option value="cashier">Cashier</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
          <Field label={isNew ? 'Password' : 'New password'} hint={isNew ? undefined : 'Leave blank to keep current'}>
            <input type="password" className="input-field input-md w-full" placeholder="••••••••" minLength={8} required={isNew} value={form.password} onChange={set('password')} />
          </Field>
        </div>

        {!isNew && (
          <>
            <div className="rounded-xl border border-base-300 p-3">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide opacity-50">
                <span>Capabilities</span>
                <span>{Object.values(perms).filter(Boolean).length}/{PERM_KEYS.length} granted</span>
              </div>
              <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {PERM_KEYS.map((k) => (
                  <li key={k}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="toggle-field toggle-sm"
                        checked={Boolean(perms[k])}
                        onChange={(e) => setPerms((p) => ({ ...p, [k]: e.target.checked }))}
                      />
                      {PERM_LABELS[k]}
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-xl border border-base-300 p-3">
              <Field label="Register PIN (for fast handover)" hint="4-8 digits · leave blank to keep current">
                <input inputMode="numeric" pattern="\d*" maxLength={8} className="input-field input-md w-full font-mono" placeholder="••••" value={form.pin} onChange={set('pin')} />
              </Field>
              {staff.hasPin && (
                <button
                  type="button"
                  className="btn-outline btn-warn btn-sm"
                  onClick={async () => {
                    try {
                      await api(`/staff/${staff.id}`, { method: 'PATCH', body: { pin: null } });
                      toast.success('PIN cleared');
                      onPin(staff);
                    } catch (err) {
                      toast.error(err.message);
                    }
                  }}
                >
                  Clear PIN
                </button>
              )}
            </div>
          </>
        )}

        <div className="modal-action">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn-cta ${busy ? 'opacity-50 pointer-events-none' : ''}`} disabled={busy}>
            {isNew ? 'Create' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

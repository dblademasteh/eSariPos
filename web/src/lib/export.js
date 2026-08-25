// CSV export helpers (client-side, no dependencies).
export function toCsv(columns, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label ?? c.key)).join(',');
  const body = rows
    .map((row) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(','))
    .join('\n');
  return `${head}\n${body}`;
}

export function downloadCsv(filename, columns, rows) {
  const csv = toCsv(columns, rows);
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

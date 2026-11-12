const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export const ROLES = ['end_user', 'sub_admin', 'admin'];
export const ROLE_LABELS = { admin: 'Admin', sub_admin: 'Sub-admin', end_user: 'End user' };
export const PLATFORMS = ['Web Portal', 'WhatsApp', 'Teams'];

export const fmtNumber = (v) => (typeof v === 'number' && Number.isFinite(v) ? number.format(v) : v ?? '—');
export const fmtCell = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'number' ? number.format(v) : String(v));
export const fmtSeconds = (ms) => (ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} s`);
export const prettyColumn = (name) => String(name).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

export function fmtDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function relativeTime(value) {
  if (!value) return '';
  const seconds = (Date.now() - new Date(value).getTime()) / 1000;
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function toCsv(table) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = table.columns.map((c) => esc(c.name)).join(',');
  return [header, ...table.rows.map((r) => table.columns.map((c) => esc(r[c.name])).join(','))].join('\n');
}

export function downloadFile(filename, href) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

export function downloadText(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  downloadFile(filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

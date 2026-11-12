import { truncate } from '../lib/http.js';

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export const formatValue = (v) => (typeof v === 'number' ? number.format(v) : v === null || v === undefined || v === '' ? '—' : String(v));

export function tableLines(table, max = 10) {
  if (!table?.rows?.length) return null;
  const cols = table.columns.slice(0, 4);
  const lines = table.rows.slice(0, max).map((r) => (cols.length === 2
    ? `${formatValue(r[cols[0].name])}: ${formatValue(r[cols[1].name])}`
    : cols.map((c) => formatValue(r[c.name])).join(' | ')));
  if (table.rowCount > max) lines.push(`…and ${table.rowCount - max} more`);
  return lines.join('\n');
}

// WhatsApp uses *bold*; other channels can pass their own emphasis.
export function chatText(result, { bold = (s) => `*${s}*`, includeTable = true } = {}) {
  if (result.kind === 'clarification' && result.clarification) {
    const { question, options } = result.clarification;
    return `${question}\n\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\nReply with the one you mean.`;
  }
  const parts = [];
  if (result.headline) parts.push(bold(result.headline));
  if (result.summary) parts.push(result.summary);
  const tableOnly = !result.chart || ['table', 'number'].includes(result.chart.type);
  if (includeTable && tableOnly && result.table?.columns?.length <= 4) {
    const lines = tableLines(result.table);
    if (lines && result.table.rowCount > 1) parts.push(lines);
  }
  if (result.followups?.length) parts.push(`You can also ask:\n${result.followups.map((f) => `• ${f}`).join('\n')}`);
  return truncate(parts.join('\n\n') || result.text || '', 4000);
}

export const evidenceCaption = (e) => [e.use_case, e.camera, e.zone, e.time].filter(Boolean).join(', ');

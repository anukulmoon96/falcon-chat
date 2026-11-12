import { CHART_TYPES } from '../../../shared/chart-option.js';

// mysql2 column type codes
const NUMERIC = new Set([0, 1, 2, 3, 4, 5, 8, 9, 13, 246]);
const DATE = new Set([7, 10, 11, 12, 14]);
const JSON_TYPE = 245;

const ID_COLUMNS = { event_id: 'use_case', camera_id: 'camera', location_id: 'location', sub_location_id: 'zone' };
const HIDDEN_COLUMNS = new Set(['image_url']);
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function shapeResult({ rows, fields }, { names = new Map(), maxRows = 2000 } = {}) {
  const truncated = rows.length > maxRows;
  const data = (truncated ? rows.slice(0, maxRows) : rows).map((r) => ({ ...r }));
  const columns = fields.map((f) => ({
    name: f.name,
    kind: NUMERIC.has(f.type) ? 'number' : DATE.has(f.type) ? 'date' : f.type === JSON_TYPE ? 'json' : 'text',
  }));

  const renames = {};
  for (const column of columns) {
    if (column.kind === 'json') {
      for (const r of data) if (r[column.name] && typeof r[column.name] === 'object') r[column.name] = JSON.stringify(r[column.name]);
      continue;
    }
    if (column.kind !== 'text') continue;
    const values = data.map((r) => r[column.name]).filter((v) => v !== null && v !== undefined && v !== '');
    if (!values.length) continue;
    const hits = values.filter((v) => names.has(String(v))).length;
    if (hits / values.length < 0.5) continue;
    for (const r of data) {
      const v = r[column.name];
      if (v !== null && v !== undefined && names.has(String(v))) r[column.name] = names.get(String(v));
    }
    const friendly = ID_COLUMNS[column.name];
    if (friendly && !columns.some((c) => c.name === friendly)) renames[column.name] = friendly;
  }

  for (const [from, to] of Object.entries(renames)) {
    for (const r of data) {
      r[to] = r[from];
      delete r[from];
    }
    columns.find((c) => c.name === from).name = to;
  }
  return { columns, rows: data, rowCount: data.length, truncated, renames };
}

export function resolveChart(viz, table) {
  const rename = (n) => (n ? table.renames[n] || n : n);
  const names = table.columns.map((c) => c.name);
  const numbers = table.columns.filter((c) => c.kind === 'number').map((c) => c.name);
  const categories = table.columns.filter((c) => c.kind !== 'number' && !HIDDEN_COLUMNS.has(c.name)).map((c) => c.name);
  const title = viz?.title || undefined;

  if (names.includes('image_url')) return { type: 'images', title };
  if (!table.rowCount) return { type: 'table', title };
  if (table.rowCount === 1 && numbers.length && (viz?.type === 'number' || categories.length === 0)) {
    return { type: 'number', y: [rename(viz?.y?.[0]) && numbers.includes(rename(viz.y[0])) ? rename(viz.y[0]) : numbers[0]], title };
  }

  let type = viz?.type || 'table';
  let x = rename(viz?.x);
  if (!names.includes(x)) x = categories[0];
  let y = (viz?.y || []).map(rename).filter((n) => numbers.includes(n) && n !== x);
  if (!y.length && numbers.length) y = [numbers.find((n) => n !== x)].filter(Boolean);
  let series = rename(viz?.series);
  if (!names.includes(series) || series === x) series = undefined;

  if (!x || !y.length || table.rowCount < 2) return { type: 'table', title };
  if (type === 'pie' && table.rowCount > 8) type = 'bar';
  if (type === 'heatmap' && !series) type = 'bar';
  if (!CHART_TYPES.includes(type)) type = type === 'table' ? 'table' : 'bar';
  return type === 'table' ? { type, title } : { type, x, y, series, title };
}

export function summarize(table, chart) {
  const stats = { rows: table.rowCount, truncated: table.truncated };
  const numbers = table.columns.filter((c) => c.kind === 'number').map((c) => c.name);
  for (const name of numbers) {
    const values = table.rows.map((r) => Number(r[name])).filter(Number.isFinite);
    if (!values.length) continue;
    const sum = values.reduce((a, b) => a + b, 0);
    stats[name] = { sum: round(sum), min: Math.min(...values), max: Math.max(...values), avg: round(sum / values.length) };
  }
  const y = chart?.y?.[0];
  if (chart?.x && y && stats[y]) {
    const sorted = [...table.rows].sort((a, b) => Number(b[y]) - Number(a[y]));
    stats.top = sorted.slice(0, 3).map((r) => ({ [chart.x]: r[chart.x], [y]: r[y] }));
    if (stats[y].sum > 0 && !chart.series) stats.top_share_pct = round((100 * Number(sorted[0][y])) / stats[y].sum, 1);
    if (chart.type === 'line' && table.rowCount >= 2 && !chart.series) {
      const first = Number(table.rows[0][y]);
      const last = Number(table.rows[table.rowCount - 1][y]);
      stats.first = { [chart.x]: table.rows[0][chart.x], [y]: first };
      stats.last = { [chart.x]: table.rows[table.rowCount - 1][chart.x], [y]: last };
      if (first > 0) stats.change_pct = round(((last - first) / first) * 100, 1);
    }
  }
  return stats;
}

export function extractEvidence(table, limit = 12) {
  if (!table.columns.some((c) => c.name === 'image_url')) return [];
  return table.rows
    .filter((r) => r.image_url && (r.id ?? r.alert_id) !== undefined)
    .slice(0, limit)
    .map((r) => ({
      alert_id: String(r.id ?? r.alert_id),
      camera: r.camera ?? r.camera_id ?? null,
      zone: r.zone ?? r.sub_location_id ?? null,
      location: r.location ?? r.location_id ?? null,
      use_case: r.use_case ?? r.event_id ?? null,
      time: r.created_at ?? null,
    }));
}

// What gets stored and sent to clients: no raw image URLs, at most 500 rows.
export function publicTable(table, limit = 500) {
  const columns = table.columns.filter((c) => !HIDDEN_COLUMNS.has(c.name));
  const rows = table.rows.slice(0, limit).map((r) => Object.fromEntries(columns.map((c) => [c.name, r[c.name] ?? null])));
  return { columns: columns.map(({ name, kind }) => ({ name, kind })), rows, rowCount: table.rowCount, truncated: table.truncated || table.rowCount > limit };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { extractEvidence, publicTable, resolveChart, shapeResult, summarize } from '../src/sql/shape.js';
import { buildChartOption } from '../../shared/chart-option.js';

const names = new Map([['Z1', 'Zone A'], ['Z2', 'Zone B'], ['C7', 'Cam 07']]);
const TEXT = 252;
const BIGINT = 8;

test('maps IDs to names, renames ID columns and keeps the chart pointing at them', () => {
  const t = shapeResult({
    rows: [{ sub_location_id: 'Z2', violations: 142 }, { sub_location_id: 'Z1', violations: 96 }],
    fields: [{ name: 'sub_location_id', type: TEXT }, { name: 'violations', type: BIGINT }],
  }, { names });
  assert.deepEqual(t.rows[0], { zone: 'Zone B', violations: 142 });
  const chart = resolveChart({ type: 'bar', x: 'sub_location_id', y: ['violations'] }, t);
  assert.equal(chart.x, 'zone');
  const stats = summarize(t, chart);
  assert.equal(stats.violations.sum, 238);
  assert.equal(stats.top_share_pct, 59.7);
  assert.ok(buildChartOption(chart, publicTable(t)));
});

test('falls back to sensible displays', () => {
  const single = shapeResult({ rows: [{ total: 376 }], fields: [{ name: 'total', type: BIGINT }] });
  assert.equal(resolveChart({ type: 'bar' }, single).type, 'number');
  const many = shapeResult({
    rows: Array.from({ length: 12 }, (_, i) => ({ k: `k${i}`, v: i })),
    fields: [{ name: 'k', type: 253 }, { name: 'v', type: 3 }],
  });
  assert.equal(resolveChart({ type: 'pie', x: 'k', y: ['v'] }, many).type, 'bar');
  assert.equal(resolveChart({ type: 'heatmap', x: 'k', y: ['v'] }, many).type, 'bar');
});

test('extracts evidence and never exposes raw image URLs', () => {
  const t = shapeResult({
    rows: [{ id: 7, image_url: 'https://cdn.example/x.jpg', camera_id: 'C7', created_at: '2026-10-21 14:32:10' }],
    fields: [{ name: 'id', type: 3 }, { name: 'image_url', type: TEXT }, { name: 'camera_id', type: TEXT }, { name: 'created_at', type: 7 }],
  }, { names });
  assert.equal(resolveChart({ type: 'images' }, t).type, 'images');
  assert.deepEqual(extractEvidence(t)[0], { alert_id: '7', camera: 'Cam 07', zone: null, location: null, use_case: null, time: '2026-10-21 14:32:10' });
  assert.ok(!publicTable(t).columns.some((c) => c.name === 'image_url'));
});

// End-to-end pipeline test against a real MySQL with the demo data loaded,
// using a fake Gemini and in-memory MongoDB collections.
//   FALCON_MYSQL_TEST=1 MYSQL_USER=... MYSQL_PASSWORD=... npm test
import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectId } from 'mongodb';

process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret-1234';
process.env.GEMINI_API_KEY ||= 'test-key';

test('answers with scope applied, names mapped, retries and evidence', {
  skip: process.env.FALCON_MYSQL_TEST !== '1' && 'set FALCON_MYSQL_TEST=1 with the demo database loaded',
  timeout: 90_000,
}, async (t) => {
  const { col } = await import('../src/db/mongo.js');
  const { closeMysql } = await import('../src/db/mysql.js');
  const { llm } = await import('../src/ai/gemini.js');
  const { PLAN_SCHEMA } = await import('../src/ai/prompts.js');
  const { answerQuestion } = await import('../src/ai/pipeline.js');
  const { DEMO } = await import('../scripts/demo-data.js');
  t.after(() => closeMysql()); // always release pools, even when an assertion fails

  const project = { _id: new ObjectId(), ...DEMO.project };
  const plantA = DEMO.knowledge.entities.locations[0].id;
  const viewer = {
    _id: new ObjectId(), firstName: 'Test', role: 'end_user', projects: [project._id],
    platformShared: ['Web Portal'], dataScopes: { [String(project._id)]: { location_ids: [plantA] } },
  };
  const admin = { ...viewer, _id: new ObjectId(), role: 'admin', dataScopes: {} };
  const fake = (docs) => ({
    findOne: async (q) => docs.find((d) => Object.entries(q).every(([k, v]) => String(d[k]) === String(v))) || null,
    find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
  });
  col.accounts = () => fake([viewer, admin]);
  col.projects = () => fake([project]);
  col.knowledge = () => fake([{ project_id: project._id, ...DEMO.knowledge }]);
  col.conversations = () => fake([]);

  const plans = [];
  llm.generateJson = async ({ schema, prompt }) => {
    if (schema === PLAN_SCHEMA) {
      const next = plans.shift();
      return { data: typeof next === 'function' ? next(prompt) : next, usage: { input: 10, output: 5 } };
    }
    return { data: { headline: 'Zone B leads.', summary: 'Test.', followups: ['Break down by shift'] }, usage: { input: 3, output: 2 } };
  };
  const ask = (account, question) => answerQuestion({
    task_id: 't',
    payload: { platform: 'Web Portal', account_id: String(account._id), project_id: String(project._id), question },
  });
  const byZone = {
    intent: 'data', rephrased_question: 'Violations by zone', filters: [],
    sql: 'SELECT sub_location_id, COUNT(*) AS violations FROM alerts GROUP BY sub_location_id ORDER BY violations DESC',
    visualization: { type: 'bar', x: 'sub_location_id', y: ['violations'] },
  };

  plans.push(byZone);
  const scoped = await ask(viewer, 'violations by zone');
  const allowed = DEMO.knowledge.entities.zones.filter((z) => z.location_id === plantA).map((z) => z.name);
  const zones = scoped.result.table.rows.map((r) => r.zone);
  assert.ok(zones.length && zones.every((z) => allowed.includes(z)), `unexpected zones: ${zones}`);
  assert.equal(scoped.result.chart.x, 'zone');
  assert.match(scoped.meta.executedSql, /^WITH alerts AS/);

  plans.push(byZone);
  const everything = await ask(admin, 'violations by zone');
  assert.ok(everything.result.table.rows.length > zones.length);

  let retryPrompt = '';
  plans.push({ intent: 'data', rephrased_question: 'x', sql: 'SELECT * FROM users', filters: [] });
  plans.push((prompt) => {
    retryPrompt = prompt;
    return { intent: 'data', rephrased_question: 'Total', sql: 'SELECT COUNT(*) AS total FROM alerts', visualization: { type: 'number', y: ['total'] }, filters: [] };
  });
  const fixed = await ask(admin, 'total alerts');
  assert.match(retryPrompt, /not available/);
  assert.equal(fixed.result.chart.type, 'number');

  plans.push({
    intent: 'data', rephrased_question: 'Latest frames', filters: [],
    sql: 'SELECT id, image_url, event_id, camera_id, sub_location_id, created_at FROM alerts ORDER BY created_at DESC LIMIT 12',
    visualization: { type: 'images' },
  });
  const frames = await ask(viewer, 'show me images');
  assert.equal(frames.result.evidence.length, 12);
  assert.ok(frames.result.evidence.every((e) => allowed.includes(e.zone)));
  assert.ok(!frames.result.table.columns.some((c) => c.name === 'image_url'));
});

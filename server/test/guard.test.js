import assert from 'node:assert/strict';
import test from 'node:test';
import { GuardError, applyScope, guardSql } from '../src/sql/guard.js';

const opts = { dbName: 'LLM_DEMO_DB', maxRows: 100 };
const rejects = (sql, pattern) => assert.throws(
  () => guardSql(sql, opts),
  (err) => err instanceof GuardError && pattern.test(err.message),
  `expected rejection for: ${sql}`,
);

test('allows a normal aggregation and caps rows', () => {
  const { sql } = guardSql("SELECT sub_location_id, COUNT(*) AS violations FROM alerts WHERE event_id = 'x' GROUP BY sub_location_id ORDER BY violations DESC;", opts);
  assert.match(sql, /LIMIT 101$/);
  assert.doesNotMatch(sql, /;/);
});

test('keeps a small LIMIT and caps a large one, preserving OFFSET', () => {
  assert.match(guardSql('SELECT id FROM alerts LIMIT 10', opts).sql, /LIMIT 10$/);
  assert.match(guardSql('SELECT id FROM alerts LIMIT 5000', opts).sql, /LIMIT 101$/);
  assert.match(guardSql('SELECT id FROM alerts LIMIT 20, 5000', opts).sql, /LIMIT 101 OFFSET 20$/);
  assert.match(guardSql('SELECT id FROM alerts LIMIT 5000 OFFSET 40', opts).sql, /LIMIT 101 OFFSET 40$/);
});

test('allows CTEs, JSON functions, window functions and tricky literals', () => {
  guardSql('WITH d AS (SELECT DATE(created_at) AS day, COUNT(*) AS c FROM alerts GROUP BY day) SELECT day, c, RANK() OVER (ORDER BY c DESC) AS r FROM d', opts);
  guardSql("SELECT JSON_UNQUOTE(JSON_EXTRACT(alert_details, '$.shift')) AS shift, COUNT(*) AS c FROM alerts GROUP BY shift", opts);
  guardSql("SELECT * FROM alerts WHERE camera_id = 'Gate #2 -- north; @night'", opts);
});

test('rejects anything other than a single read of alerts', () => {
  rejects('SELECT * FROM users', /not available/);
  rejects('SELECT * FROM LLM_OTHER_DB.alerts', /database name/);
  rejects('SELECT * FROM information_schema.tables', /System schemas/);
  rejects('SELECT 1; DROP TABLE alerts', /one statement/);
  rejects('DELETE FROM alerts', /single SELECT/);
  rejects("SELECT * FROM alerts INTO OUTFILE '/tmp/x'", /INTO/);
  rejects('SELECT SLEEP(5)', /not allowed/);
  rejects('SELECT @@version', /variables/);
  rejects('SELECT * FROM alerts FOR UPDATE', /Locking/);
  rejects('SELECT * FROM alerts /* hi */', /Comments/);
  rejects('WITH alerts AS (SELECT 1) SELECT * FROM alerts', /may not be named/);
  rejects('SELECT * FROM alerts WHERE id IN (SELECT id FROM accounts)', /not available/);
});

test('injects the data scope as a CTE that shadows alerts, with escaped values', () => {
  const scope = { location_ids: ['L1', "x' OR '1'='1"], camera_ids: ['C1'] };
  const { sql } = guardSql('SELECT COUNT(*) AS n FROM alerts', { ...opts, scope });
  assert.match(sql, /^WITH alerts AS \(SELECT \* FROM `LLM_DEMO_DB`\.`alerts` WHERE `location_id` IN \('L1', 'x\\' OR \\'1\\'=\\'1'\) AND `camera_id` IN \('C1'\)\)/);
  const merged = guardSql('WITH d AS (SELECT * FROM alerts) SELECT COUNT(*) FROM d', { ...opts, scope }).sql;
  assert.match(merged, /^WITH alerts AS \(.*\),\nd AS/s);
  assert.equal(applyScope('SELECT 1', 'DB', null), 'SELECT 1');
});

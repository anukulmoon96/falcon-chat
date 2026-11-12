import mysql from 'mysql2';
import sqlParser from 'node-sql-parser';
import { SCOPE_COLUMNS } from '../auth/permissions.js';

const parser = new sqlParser.Parser();
const OPTIONS = { database: 'MySQL' };

const DENIED_FUNCTIONS = /\b(sleep|benchmark|load_file|get_lock|release_lock|release_all_locks|is_free_lock|is_used_lock|master_pos_wait|source_pos_wait|wait_for_executed_gtid_set|sys_exec|sys_eval)\s*\(/i;
const SYSTEM_SCHEMAS = /\b(information_schema|performance_schema|mysql|sys)\s*\./i;
const LOCKING = /\bfor\s+(update|share)\b|\block\s+in\s+share\s+mode\b/i;
const TAIL_LIMIT = /\blimit\s+(\d+)(?:\s*,\s*(\d+)|\s+offset\s+(\d+))?\s*$/i;

export class GuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GuardError';
  }
}

// Blank out string literals and quoted identifiers so keyword checks
// don't trip on values like '$.shift' or a zone called "Gate #2".
export function maskLiterals(sql) {
  return sql
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.|"")*"/g, '""')
    .replace(/`(?:[^`]|``)*`/g, '`x`');
}

function collectCteNames(node, out = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) collectCteNames(item, out);
  } else if (node && typeof node === 'object') {
    if (Array.isArray(node.with)) {
      for (const w of node.with) {
        const name = typeof w?.name === 'string' ? w.name : w?.name?.value;
        if (name) out.add(String(name).toLowerCase());
      }
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') collectCteNames(value, out);
    }
  }
  return out;
}

function enforceLimit(sql, maxRows) {
  const m = sql.match(TAIL_LIMIT);
  if (!m) return `${sql}\nLIMIT ${maxRows + 1}`;
  const count = Number(m[2] ?? m[1]);
  if (count <= maxRows) return sql;
  const offset = m[2] !== undefined ? m[1] : m[3];
  return `${sql.slice(0, m.index)}LIMIT ${maxRows + 1}${offset ? ` OFFSET ${offset}` : ''}`;
}

// MySQL has no row-level security, so the user's scope is applied by shadowing
// `alerts` with a CTE of the same name that only contains rows they may see.
// The CTE reads the real table through its database-qualified name.
export function applyScope(sql, dbName, scope) {
  if (!scope) return sql;
  if (!/^[A-Za-z0-9_]{1,64}$/.test(dbName)) throw new GuardError('Invalid database name.');
  const conditions = Object.entries(SCOPE_COLUMNS)
    .filter(([key]) => scope[key]?.length)
    .map(([key, column]) => `\`${column}\` IN (${scope[key].map((v) => mysql.escape(String(v))).join(', ')})`);
  if (!conditions.length) return sql;
  const cte = `alerts AS (SELECT * FROM \`${dbName}\`.\`alerts\` WHERE ${conditions.join(' AND ')})`;
  const lead = sql.match(/^\s*with\s+(recursive\s+)?/i);
  if (lead) return `WITH ${lead[1] ? 'RECURSIVE ' : ''}${cte},\n${sql.slice(lead[0].length)}`;
  return `WITH ${cte}\n${sql}`;
}

export function guardSql(rawSql, { dbName, scope = null, maxRows = 2000 }) {
  let sql = String(rawSql || '').trim().replace(/;+\s*$/, '').trim();
  if (!sql) throw new GuardError('The query is empty.');
  if (sql.length > 8000) throw new GuardError('The query is too long.');

  const masked = maskLiterals(sql);
  if (masked.includes(';')) throw new GuardError('Only one statement is allowed.');
  if (/--|#|\/\*/.test(masked)) throw new GuardError('Comments are not allowed in queries.');
  if (masked.includes('@')) throw new GuardError('User and system variables are not allowed.');
  if (DENIED_FUNCTIONS.test(masked)) throw new GuardError('That function is not allowed.');
  if (SYSTEM_SCHEMAS.test(masked)) throw new GuardError('System schemas are not allowed.');
  if (/\binto\b/i.test(masked)) throw new GuardError('SELECT ... INTO is not allowed.');
  if (LOCKING.test(masked)) throw new GuardError('Locking reads are not allowed.');

  let ast;
  try {
    ast = parser.astify(sql, OPTIONS);
  } catch (err) {
    throw new GuardError(`The query could not be parsed: ${String(err.message).split('\n')[0].slice(0, 200)}`);
  }
  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1 || statements[0]?.type !== 'select') {
    throw new GuardError('Only a single SELECT statement is allowed.');
  }

  const ctes = collectCteNames(statements[0]);
  if (ctes.has('alerts')) throw new GuardError('A CTE may not be named "alerts".');

  for (const entry of parser.tableList(sql, OPTIONS)) {
    const [type, db, table] = entry.split('::');
    if (String(type).toLowerCase() !== 'select') throw new GuardError('Only SELECT is allowed.');
    if (db !== 'null') throw new GuardError('Do not prefix table names with a database name.');
    const name = String(table).toLowerCase();
    if (name !== 'alerts' && !ctes.has(name)) {
      throw new GuardError(`Table "${table}" is not available. Only "alerts" can be queried.`);
    }
  }

  sql = enforceLimit(sql, maxRows);
  return { sql: applyScope(sql, dbName, scope), maxRows };
}

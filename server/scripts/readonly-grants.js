// Prints one read-only MySQL user per project, so a project's questions can
// only ever read that project's alerts table:
//   npm run grants > grants.sql      (run grants.sql as a MySQL admin)
// The matching MYSQL_PROJECT_CREDENTIALS value is printed to stderr; put it in
// your secrets manager, not in git.
import crypto from 'node:crypto';
import { closeMongo, col, connectMongo } from '../src/db/mongo.js';

await connectMongo();
const projects = await col.projects().find({}).sort({ name: 1 }).toArray();
const host = process.env.GRANT_HOST || '%';
const credentials = {};
const lines = ['-- Falcon read-only users, one per project database'];

for (const p of projects) {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(p.db_name || '')) {
    console.error(`Skipping "${p.name}": db_name "${p.db_name}" is not a plain database name`);
    continue;
  }
  const user = `falcon_${p.db_name.toLowerCase()}`.slice(0, 32);
  const password = crypto.randomBytes(18).toString('base64url');
  credentials[p.db_name] = { user, password };
  lines.push(
    '',
    `-- ${p.name}`,
    `CREATE USER IF NOT EXISTS '${user}'@'${host}' IDENTIFIED BY '${password}' WITH MAX_USER_CONNECTIONS 20;`,
    `ALTER USER '${user}'@'${host}' IDENTIFIED BY '${password}';`,
    `GRANT SELECT ON \`${p.db_name}\`.\`alerts\` TO '${user}'@'${host}';`,
  );
}
console.log(lines.join('\n'));
console.error('\nMYSQL_PROJECT_CREDENTIALS=' + JSON.stringify(credentials));
await closeMongo();

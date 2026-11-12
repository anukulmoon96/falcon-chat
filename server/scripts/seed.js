// Creates the demo project, its knowledge, and an admin who can sign in to the web portal.
//   npm run seed               admin only
//   npm run seed -- --samples  also a sub-admin and an end user limited to Plant A
// Existing accounts are never overwritten; they only get the demo project added.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { closeMongo, col, connectMongo } from '../src/db/mongo.js';
import { escapeRegex } from '../src/lib/http.js';
import { saveKnowledge } from '../src/services/knowledge.js';
import { DEMO } from './demo-data.js';

await connectMongo();
const now = new Date();
await col.projects().updateOne(
  { db_name: DEMO.project.db_name },
  { $setOnInsert: { ...DEMO.project, isActive: true, createdAt: now } },
  { upsert: true },
);
const project = await col.projects().findOne({ db_name: DEMO.project.db_name });
await saveKnowledge(project._id, DEMO.knowledge);

const report = [];
async function ensureAccount({ email, password, ...fields }) {
  const existing = await col.accounts().findOne({ email: { $regex: `^${escapeRegex(email)}$`, $options: 'i' } });
  if (existing) {
    await col.accounts().updateOne({ _id: existing._id }, { $addToSet: { projects: project._id } });
    if (!existing.passwordHash) {
      const pw = password || crypto.randomBytes(12).toString('base64url');
      await col.accounts().updateOne({ _id: existing._id }, { $set: { passwordHash: await bcrypt.hash(pw, 12), mustChangePassword: !password } });
      report.push({ email, password: pw, status: 'existing account, password set' });
    } else {
      report.push({ email, password: '(unchanged)', status: 'existing account' });
    }
    return;
  }
  const pw = password || crypto.randomBytes(12).toString('base64url');
  await col.accounts().insertOne({
    username: email.split('@')[0],
    email,
    mobileNumber: '',
    projects: [project._id],
    selectedProject: { _id: project._id, name: project.name, db_name: project.db_name },
    isProjectSelectionOn: false,
    isActive: true,
    dataScopes: {},
    passwordHash: await bcrypt.hash(pw, 12),
    mustChangePassword: !password,
    sessionVersion: 0,
    createdAt: now,
    updatedAt: now,
    ...fields,
  });
  report.push({ email, password: pw, status: 'created' });
}

await ensureAccount({
  email: process.env.SEED_ADMIN_EMAIL || 'admin@falcon.local',
  password: process.env.SEED_ADMIN_PASSWORD,
  firstName: 'Falcon',
  lastName: 'Admin',
  companyName: 'Company A',
  role: 'admin',
  platformShared: ['Web Portal', 'WhatsApp', 'Teams'],
});

if (process.argv.includes('--samples')) {
  const plantA = DEMO.knowledge.entities.locations[0].id;
  await ensureAccount({
    email: 'subadmin@falcon.local', firstName: 'Meera', lastName: 'Shah', companyName: 'Demo Client',
    designation: 'EHS Head', role: 'sub_admin', platformShared: ['Web Portal', 'WhatsApp'],
  });
  await ensureAccount({
    email: 'viewer@falcon.local', firstName: 'Arjun', lastName: 'Rao', companyName: 'Demo Client',
    designation: 'Shift Supervisor', role: 'end_user', platformShared: ['Web Portal', 'WhatsApp'],
    dataScopes: { [String(project._id)]: { location_ids: [plantA] } },
  });
}

console.table(report);
console.log(`Project "${project.name}" (${project.db_name}) is ready. Sign in at the web portal with the accounts above.`);
await closeMongo();

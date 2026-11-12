import { MongoClient } from 'mongodb';
import { config } from '../config.js';
import { logger } from '../lib/http.js';

let client;
let db;

export async function connectMongo() {
  client = new MongoClient(config.mongo.uri, { appName: 'falcon-server' });
  await client.connect();
  db = client.db(config.mongo.db);
  await ensureIndexes();
  logger.info({ db: config.mongo.db }, 'MongoDB connected');
  return db;
}

export const closeMongo = () => client?.close();
export const getDb = () => db;

const collection = (name) => () => db.collection(name);

// accounts, projects, conversations and tasks are the existing Falcon collections.
// threads, knowledge and audit_logs are new.
export const col = {
  accounts: collection('accounts'),
  projects: collection('projects'),
  conversations: collection('conversations'),
  tasks: collection('tasks'),
  threads: collection('threads'),
  knowledge: collection('knowledge'),
  audit: collection('audit_logs'),
};

async function ensureIndexes() {
  const specs = [
    ['accounts', { mobileNumber: 1 }],
    ['accounts', { email: 1 }],
    ['accounts', { 'teams.aadObjectId': 1 }],
    ['tasks', { task_id: 1 }, { unique: true }],
    ['tasks', { source: 1, status: 1, created_at: 1 }],
    ['tasks', { external_id: 1 }, { unique: true, partialFilterExpression: { external_id: { $type: 'string' } } }],
    ['conversations', { created_at: -1 }],
    ['conversations', { thread_id: 1, created_at: 1 }],
    ['conversations', { project_id: 1, created_at: -1 }],
    ['conversations', { account_id: 1, created_at: -1 }],
    ['threads', { account_id: 1, project_id: 1, updated_at: -1 }],
    ['knowledge', { project_id: 1 }, { unique: true }],
    ['audit_logs', { created_at: -1 }],
    ['uploads.files', { 'metadata.attached': 1, uploadDate: 1 }],
  ];
  for (const [name, keys, options] of specs) {
    try {
      await db.collection(name).createIndex(keys, options);
    } catch (err) {
      logger.warn({ collection: name, keys, err: err.message }, 'Index not created');
    }
  }
}

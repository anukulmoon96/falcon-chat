import express from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { col } from '../db/mongo.js';
import { hasDedicatedCredentials, isValidDbName, readQuery } from '../db/mysql.js';
import { HttpError, oid, parse } from '../lib/http.js';
import { requirePermission } from '../auth/session.js';
import { canUseProject } from '../auth/permissions.js';
import { accessibleProjects, audit, publicProject } from '../services/accounts.js';
import { getKnowledge, knowledgeSchema, saveKnowledge } from '../services/knowledge.js';

export const projectsRouter = express.Router();

const ZONES = new Set(Intl.supportedValuesOf('timeZone'));
const projectFields = {
  name: z.string().trim().min(1).max(120),
  dbName: z.string().trim().refine(isValidDbName, 'Use letters, numbers and underscores only'),
  timezone: z.string().refine((tz) => ZONES.has(tz), 'Pick a valid IANA time zone, e.g. Asia/Kolkata'),
  description: z.string().trim().max(500),
  isActive: z.boolean(),
};

async function accessibleProject(user, id) {
  const project = await col.projects().findOne({ _id: oid(id, 'project') });
  if (!project || !canUseProject(user, project._id)) throw new HttpError(404, 'That project was not found.');
  return project;
}

projectsRouter.get('/', async (req, res) => {
  res.json((await accessibleProjects(req.user)).map((p) => publicProject(p, req.user)));
});

projectsRouter.post('/', requirePermission('projects.manage'), async (req, res) => {
  const data = parse(z.object({ ...projectFields, timezone: projectFields.timezone.default(config.defaultTimezone), description: projectFields.description.default(''), isActive: projectFields.isActive.default(true) }), req.body);
  if (await col.projects().findOne({ db_name: data.dbName })) throw new HttpError(409, 'A project already uses that database.');
  const doc = { name: data.name, db_name: data.dbName, timezone: data.timezone, description: data.description, isActive: data.isActive, createdAt: new Date() };
  const { insertedId } = await col.projects().insertOne(doc);
  audit(req.user, 'project.created', { id: insertedId, name: doc.name });
  res.status(201).json(publicProject({ ...doc, _id: insertedId }, req.user));
});

projectsRouter.patch('/:id', requirePermission('projects.manage'), async (req, res) => {
  const data = parse(z.object(projectFields).partial(), req.body);
  const set = { updatedAt: new Date() };
  if (data.name !== undefined) set.name = data.name;
  if (data.dbName !== undefined) set.db_name = data.dbName;
  if (data.timezone !== undefined) set.timezone = data.timezone;
  if (data.description !== undefined) set.description = data.description;
  if (data.isActive !== undefined) set.isActive = data.isActive;
  const project = await col.projects().findOneAndUpdate({ _id: oid(req.params.id, 'project') }, { $set: set }, { returnDocument: 'after' });
  if (!project) throw new HttpError(404, 'That project was not found.');
  if (set.name || set.db_name) {
    await col.accounts().updateMany(
      { 'selectedProject._id': project._id },
      { $set: { 'selectedProject.name': project.name, 'selectedProject.db_name': project.db_name } },
    );
  }
  audit(req.user, 'project.updated', { id: project._id, name: project.name }, { fields: Object.keys(data) });
  res.json(publicProject(project, req.user));
});

projectsRouter.post('/:id/test', requirePermission('projects.manage'), async (req, res) => {
  const project = await accessibleProject(req.user, req.params.id);
  try {
    const { rows, ms } = await readQuery(
      project.db_name,
      'SELECT COUNT(*) AS alerts, MIN(created_at) AS first_alert, MAX(created_at) AS last_alert FROM alerts',
      { timeZone: project.timezone || config.defaultTimezone },
    );
    res.json({ ok: true, ms, stats: rows[0], dedicatedUser: hasDedicatedCredentials(project.db_name) });
  } catch (err) {
    res.json({ ok: false, error: err.sqlMessage || err.message, dedicatedUser: hasDedicatedCredentials(project.db_name) });
  }
});

projectsRouter.get('/:id/knowledge', requirePermission('console.view'), async (req, res) => {
  const project = await accessibleProject(req.user, req.params.id);
  const { _id, project_id: _p, ...knowledge } = await getKnowledge(project._id);
  res.json(knowledge);
});

projectsRouter.put('/:id/knowledge', requirePermission('knowledge.manage'), async (req, res) => {
  const project = await accessibleProject(req.user, req.params.id);
  const data = parse(knowledgeSchema, req.body);
  await saveKnowledge(project._id, data, req.user);
  audit(req.user, 'knowledge.updated', { id: project._id, name: project.name }, {
    events: data.entities.events.length, zones: data.entities.zones.length, cameras: data.entities.cameras.length, examples: data.examples.length,
  });
  res.json({ ok: true });
});

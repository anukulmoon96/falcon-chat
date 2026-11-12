import { z } from 'zod';
import { col } from '../db/mongo.js';
import { oid } from '../lib/http.js';

const entity = z.object({ id: z.coerce.string().min(1), name: z.string().trim().min(1) }).passthrough();

export const knowledgeSchema = z.object({
  entities: z.object({
    events: z.array(entity).default([]),
    locations: z.array(entity).default([]),
    zones: z.array(entity.extend({ location_id: z.coerce.string().optional() })).default([]),
    cameras: z.array(entity.extend({ zone_id: z.coerce.string().optional(), location_id: z.coerce.string().optional() })).default([]),
  }).default({ events: [], locations: [], zones: [], cameras: [] }),
  glossary: z.array(z.object({ term: z.string().trim().min(1), meaning: z.string().trim().min(1) })).max(200).default([]),
  notes: z.string().max(8000).default(''),
  examples: z.array(z.object({ question: z.string().trim().min(1), sql: z.string().trim().min(1) })).max(100).default([]),
  suggestedQuestions: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
});

const EMPTY = knowledgeSchema.parse({});

export async function getKnowledge(projectId) {
  const doc = await col.knowledge().findOne({ project_id: oid(projectId) });
  if (!doc) return structuredClone(EMPTY);
  return { ...EMPTY, ...doc, entities: { ...EMPTY.entities, ...(doc.entities || {}) } };
}

export async function saveKnowledge(projectId, data, actor) {
  await col.knowledge().updateOne(
    { project_id: oid(projectId) },
    { $set: { ...data, project_id: oid(projectId), updated_at: new Date(), updated_by: actor?._id || null } },
    { upsert: true },
  );
}

// Only entities inside the user's data scope are shown to the model,
// so an out-of-scope zone or camera cannot even be referenced.
export function scopeEntities(entities, scope) {
  if (!scope) return entities;
  const keep = (list, ids) => (ids ? list.filter((e) => ids.includes(String(e.id))) : list);
  const locs = scope.location_ids;
  const zones = scope.sub_location_ids;
  return {
    events: keep(entities.events, scope.event_ids),
    locations: keep(entities.locations, locs),
    zones: keep(entities.zones, zones).filter((z) => !locs || !z.location_id || locs.includes(String(z.location_id))),
    cameras: keep(entities.cameras, scope.camera_ids).filter((c) => (
      (!locs || !c.location_id || locs.includes(String(c.location_id)))
      && (!zones || !c.zone_id || zones.includes(String(c.zone_id)))
    )),
  };
}

export function nameIndex(entities) {
  const map = new Map();
  for (const kind of ['events', 'locations', 'zones', 'cameras']) {
    for (const e of entities[kind] || []) map.set(String(e.id), e.name);
  }
  return map;
}

export function defaultSuggestions(knowledge) {
  if (knowledge.suggestedQuestions?.length) return knowledge.suggestedQuestions;
  const event = knowledge.entities.events[0]?.name?.toLowerCase() || 'safety';
  const zone = knowledge.entities.zones[0]?.name;
  return [
    `How many ${event} alerts were there this week?`,
    'Which zone had the most violations last week?',
    'Show the daily trend of violations for the last 30 days',
    zone ? `Show me recent violation images from ${zone}` : 'Show me the latest violation images',
    'At what hours do violations peak?',
  ];
}

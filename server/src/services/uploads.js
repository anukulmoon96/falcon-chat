import { GridFSBucket } from 'mongodb';
import { getDb } from '../db/mongo.js';
import { HttpError, logger, toObjectIds } from '../lib/http.js';

// Files people attach to chat questions. Stored in GridFS so the API and the
// worker (which may run on another host) read them from the same place.
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 4;
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024; // Gemini's inline request limit leaves headroom at ~20 MB

// Types Gemini reads natively. Text-like files are passed to the model as text.
export const TYPES = {
  'image/png': { kind: 'image', ext: 'png' },
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/webp': { kind: 'image', ext: 'webp' },
  'image/heic': { kind: 'image', ext: 'heic' },
  'image/heif': { kind: 'image', ext: 'heif' },
  'application/pdf': { kind: 'document', ext: 'pdf' },
  'text/plain': { kind: 'text', ext: 'txt' },
  'text/csv': { kind: 'text', ext: 'csv' },
  'text/markdown': { kind: 'text', ext: 'md' },
  'application/json': { kind: 'text', ext: 'json' },
};

const bucket = () => new GridFSBucket(getDb(), { bucketName: 'uploads' });
const files = () => getDb().collection('uploads.files');

// Checks the bytes, not just the declared type, so a renamed file can't slip through.
function sniff(buf, declared) {
  const head = (n) => buf.subarray(0, n);
  if (head(8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (head(4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp' && /^(heic|heix|mif1|msf1|heif)/.test(buf.subarray(8, 12).toString('ascii'))) {
    return declared === 'image/heif' ? 'image/heif' : 'image/heic';
  }
  if (head(5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (TYPES[declared]?.kind === 'text' && !buf.subarray(0, 8192).includes(0)) return declared;
  return null;
}

const MIME_BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([mime, t]) => [t.ext, mime]));
MIME_BY_EXT.jpeg = 'image/jpeg';

export function publicUpload(f) {
  return { id: String(f._id), name: f.filename, type: f.metadata.contentType, kind: TYPES[f.metadata.contentType]?.kind || 'document', size: f.length };
}

export async function saveUpload({ account, projectId, filename, declaredType, body }) {
  if (!body?.length) throw new HttpError(400, 'That file is empty.');
  if (body.length > MAX_FILE_BYTES) throw new HttpError(413, `Files can be up to ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  const name = String(filename || 'file').replace(/[\\/\0\r\n]/g, '_').slice(0, 160) || 'file';
  // Browsers often send CSV/Markdown as application/octet-stream or vnd.ms-excel; fall back to the extension.
  const guessed = TYPES[declaredType] ? declaredType : MIME_BY_EXT[name.split('.').pop()?.toLowerCase()];
  const contentType = sniff(body, guessed);
  if (!contentType) throw new HttpError(415, 'That file type isn’t supported. Use an image (PNG, JPG, WebP, HEIC), a PDF, or a text file (TXT, CSV, MD, JSON).');

  const id = await new Promise((resolve, reject) => {
    const stream = bucket().openUploadStream(name, {
      metadata: { contentType, account_id: account._id, project_id: projectId, attached: false },
    });
    stream.once('finish', () => resolve(stream.id));
    stream.once('error', reject);
    stream.end(body);
  });
  return publicUpload(await files().findOne({ _id: id }));
}

// Looks up uploads owned by `account`, keeping the order given.
export async function findUploads(account, ids) {
  const objectIds = toObjectIds(ids);
  if (objectIds.length !== ids.length) throw new HttpError(400, 'One of the attachments is invalid.');
  const docs = await files().find({ _id: { $in: objectIds }, 'metadata.account_id': account._id }).toArray();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return ids.map((id) => {
    const doc = byId.get(String(id));
    if (!doc) throw new HttpError(404, 'One of the attachments was not found. Attach it again.');
    return doc;
  });
}

export const markAttached = (ids) => files().updateMany({ _id: { $in: toObjectIds(ids) } }, { $set: { 'metadata.attached': true } });

export async function readUpload(id) {
  const chunks = [];
  for await (const chunk of bucket().openDownloadStream(toObjectIds([id])[0])) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export const openUploadStream = (id) => bucket().openDownloadStream(toObjectIds([id])[0]);
// With no account, finds the file regardless of owner (callers check access themselves).
export const findUploadForViewer = (id, account) => files().findOne({ _id: toObjectIds([id])[0], ...(account && { 'metadata.account_id': account._id }) });

// Uploads that were never sent with a question are removed after a day.
export async function removeAbandonedUploads() {
  const stale = await files()
    .find({ 'metadata.attached': false, uploadDate: { $lt: new Date(Date.now() - 24 * 3600_000) } }, { projection: { _id: 1 } })
    .limit(200).toArray();
  for (const { _id } of stale) {
    await bucket().delete(_id).catch((err) => logger.warn({ err: err.message, id: String(_id) }, 'Could not remove upload'));
  }
}

import { ApiError } from './api.js';

// Mirrors the server's limits (server/src/services/uploads.js) so people hear about
// a problem before waiting for an upload.
export const MAX_FILES = 4;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

const BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', json: 'application/json',
};
const ALLOWED = new Set(Object.values(BY_EXT));
export const ACCEPT = [...ALLOWED, ...Object.keys(BY_EXT).map((e) => `.${e}`)].join(',');

export const fileType = (file) => (ALLOWED.has(file.type) ? file.type : BY_EXT[file.name.split('.').pop()?.toLowerCase()] || file.type || '');
export const isImage = (type) => String(type).startsWith('image/');

export function checkFile(file) {
  if (!ALLOWED.has(fileType(file))) return `“${file.name}” isn’t a supported type. Use an image, a PDF, or a TXT, CSV, MD or JSON file.`;
  if (file.size > MAX_FILE_BYTES) return `“${file.name}” is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
  if (!file.size) return `“${file.name}” is empty.`;
  return null;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// XHR rather than fetch, for upload progress. Resolves to { id, name, type, kind, size }.
export function uploadFile(file, projectId, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/chat/uploads?projectId=${encodeURIComponent(projectId)}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-File-Type', fileType(file));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        if (xhr.status === 401) window.dispatchEvent(new Event('falcon:unauthorized'));
        reject(new ApiError(xhr.status, data?.error || `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed. Check your connection and try again.'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

import { useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import Modal from './Modal.jsx';
import { formatBytes, isImage } from '../lib/uploads.js';

// Files sent with a question, shown above its bubble. Images open in a viewer.
export default function Attachments({ items }) {
  const [open, setOpen] = useState(null);
  if (!items?.length) return null;
  const src = (a) => a.preview || a.url;
  const images = items.filter((a) => isImage(a.type) && src(a));
  const others = items.filter((a) => !images.includes(a));
  const current = open !== null ? images[open] : null;

  return (
    <div className="sent-attachments">
      {images.length > 0 && (
        <div className={`sent-images count-${Math.min(images.length, 4)}`}>
          {images.map((a, i) => (
            <button key={a.id} type="button" className="sent-image" onClick={() => setOpen(i)} aria-label={`View ${a.name}`}>
              <img src={src(a)} alt={a.name} loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {others.map((a) => (
        <a key={a.id} className="sent-file" href={a.url} target="_blank" rel="noreferrer" title={`Open ${a.name}`}>
          <span className="attach-icon" aria-hidden="true"><FileText /></span>
          <span className="attach-text">
            <span className="attach-name">{a.name}</span>
            <span className="attach-meta">{a.type === 'application/pdf' ? 'PDF' : a.name.split('.').pop()?.toUpperCase()} · {formatBytes(a.size)}</span>
          </span>
        </a>
      ))}
      <Modal open={Boolean(current)} onClose={() => setOpen(null)} title={current?.name || ''} wide>
        {current && (
          <figure className="image-viewer">
            <img src={src(current)} alt={current.name} />
            <figcaption>
              <span>{formatBytes(current.size)}</span>
              {current.url && <a href={current.url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />Open original</a>}
            </figcaption>
          </figure>
        )}
      </Modal>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Modal from './Modal.jsx';
import { IconButton } from './ui.jsx';

const describe = (e) => [e.use_case, e.camera, e.zone].filter(Boolean).join(', ');

export default function Evidence({ items }) {
  const [open, setOpen] = useState(null);
  const current = open === null ? null : items[open];
  const isOpen = current !== null;
  const step = (d) => setOpen((i) => (i + d + items.length) % items.length);

  // The arrow keys page through frames while the viewer is open.
  useEffect(() => {
    if (!isOpen || items.length < 2) return undefined;
    const onKey = (e) => {
      // Leave modified arrows alone (Alt+Left is the browser's Back).
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, items.length]);

  return (
    <>
      <ul className="evidence">
        {items.map((e, i) => (
          <li key={e.alert_id}>
            <button type="button" className="frame" onClick={() => setOpen(i)} aria-label={`Open frame ${i + 1}: ${describe(e)}`}>
              <img src={e.src} alt="" loading="lazy" />
            </button>
            <p className="frame-caption"><span>{e.camera || e.zone || 'Camera'}</span><time>{e.time}</time></p>
          </li>
        ))}
      </ul>
      <Modal open={isOpen} onClose={() => setOpen(null)} title={current ? current.use_case || 'Evidence frame' : ''} wide>
        {current && (
          <figure className="lightbox">
            <img src={current.src} alt={describe(current)} />
            <figcaption>
              <span>{[current.camera, current.zone, current.location].filter(Boolean).join(' · ')}</span>
              <time>{current.time}</time>
              {items.length > 1 && (
                <span className="lightbox-nav">
                  <IconButton label="Previous frame" shortcut="ArrowLeft" onClick={() => step(-1)}><ChevronLeft /></IconButton>
                  <span className="tabular" aria-live="polite">{open + 1} of {items.length}</span>
                  <IconButton label="Next frame" shortcut="ArrowRight" onClick={() => step(1)}><ChevronRight /></IconButton>
                </span>
              )}
            </figcaption>
          </figure>
        )}
      </Modal>
    </>
  );
}

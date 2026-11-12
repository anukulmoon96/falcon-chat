import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

// Native <dialog>: focus trapping, Escape and the backdrop come for free.
export default function Modal({ open, onClose, title, footer, wide = false, children }) {
  const ref = useRef(null);
  const titleId = useId();

  // Focus goes back to whatever opened the dialog when it closes, including when it
  // unmounts (editors are rendered only while open, so the browser can't do it for us).
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return undefined;
    const opener = document.activeElement;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal${wide ? ' modal-wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {open && (
        <div className="modal-inner">
          <header className="modal-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X /></button>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

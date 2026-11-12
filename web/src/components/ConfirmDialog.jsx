import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';

// Confirmation for destructive actions. onConfirm may return a promise; the dialog
// stays open with a busy button until it settles, and shows its error if it fails.
export default function ConfirmDialog({ open, title, children, confirmLabel = 'Delete', busyLabel = 'Deleting…', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancel = useRef(null);

  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setError('');
    // Safe default: focus lands on Cancel, not on the destructive action.
    cancel.current?.focus();
  }, [open]);

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err.message || 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      title={title}
      footer={(
        <>
          <button ref={cancel} type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-danger" onClick={confirm} disabled={busy}>{busy ? busyLabel : confirmLabel}</button>
        </>
      )}
    >
      <div className="confirm-body">{children}</div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}

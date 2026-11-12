import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ArrowUp, FileText, Mic, Paperclip, Square, Upload, X } from 'lucide-react';
import { useSpeechToText } from '../lib/speech.js';
import { ACCEPT, MAX_FILES, MAX_TOTAL_BYTES, checkFile, fileType, formatBytes, isImage, uploadFile } from '../lib/uploads.js';

const MAX = 1000;

export default function Composer({ onSend, disabled, placeholder, draft, onDraftUsed, projectId }) {
  const [value, setValue] = useState('');
  const [files, setFiles] = useState([]);
  const [notice, setNotice] = useState('');
  const [dropTarget, setDropTarget] = useState(null);
  const [dragging, setDragging] = useState(false);
  const ref = useRef(null);
  const formRef = useRef(null);
  const picker = useRef(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  // Text that was already typed when dictation started; spoken words are appended to it.
  const base = useRef('');
  const speech = useSpeechToText((final, interim) => {
    setValue(`${base.current}${final}${interim}`.slice(0, MAX));
  });

  useEffect(() => {
    if (!draft) return;
    setValue(draft);
    ref.current?.focus();
    onDraftUsed?.();
  }, [draft, onDraftUsed]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  const patchFile = (key, fields) => setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...fields } : f)));
  const release = (f) => { f.abort?.abort(); if (f.preview) URL.revokeObjectURL(f.preview); };

  const removeFile = (key) => setFiles((list) => {
    const f = list.find((x) => x.key === key);
    if (f) release(f);
    return list.filter((x) => x.key !== key);
  });

  // Uploads belong to a project, so switching project clears them; unmounting cancels them.
  useEffect(() => () => { filesRef.current.forEach(release); setFiles([]); }, [projectId]);

  const addFiles = useCallback((list) => {
    const incoming = Array.from(list || []);
    if (!incoming.length || !projectId) return;
    const current = filesRef.current;
    const problems = [];
    let total = current.reduce((sum, f) => sum + f.size, 0);
    const accepted = [];
    for (const file of incoming) {
      if (current.length + accepted.length >= MAX_FILES) { problems.push(`You can attach up to ${MAX_FILES} files per question.`); break; }
      const problem = checkFile(file);
      if (problem) { problems.push(problem); continue; }
      if (total + file.size > MAX_TOTAL_BYTES) { problems.push(`Attachments can add up to ${MAX_TOTAL_BYTES / 1024 / 1024} MB per question.`); continue; }
      total += file.size;
      const type = fileType(file);
      accepted.push({
        key: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type,
        preview: isImage(type) && type !== 'image/heic' && type !== 'image/heif' ? URL.createObjectURL(file) : null,
        status: 'uploading',
        progress: 0,
        abort: new AbortController(),
        file,
      });
    }
    setNotice(problems[0] || '');
    if (!accepted.length) return;
    setFiles((list) => [...list, ...accepted]);
    for (const item of accepted) {
      uploadFile(item.file, projectId, { signal: item.abort.signal, onProgress: (progress) => patchFile(item.key, { progress }) })
        .then((upload) => patchFile(item.key, { status: 'done', progress: 1, upload }))
        .catch((err) => { if (err.name !== 'AbortError') patchFile(item.key, { status: 'error', error: err.message }); });
    }
  }, [projectId]);

  // Dropping anywhere on the conversation attaches the files.
  useEffect(() => {
    const zone = formRef.current?.closest('.conversation');
    if (!zone) return undefined;
    setDropTarget(zone);
    let depth = 0;
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    const enter = (e) => { if (!hasFiles(e) || disabled) return; e.preventDefault(); depth += 1; setDragging(true); };
    const over = (e) => { if (!hasFiles(e) || disabled) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
    const leave = (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const drop = (e) => {
      if (!hasFiles(e) || disabled) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      addFiles(e.dataTransfer.files);
      ref.current?.focus();
    };
    zone.addEventListener('dragenter', enter);
    zone.addEventListener('dragover', over);
    zone.addEventListener('dragleave', leave);
    zone.addEventListener('drop', drop);
    return () => {
      zone.removeEventListener('dragenter', enter);
      zone.removeEventListener('dragover', over);
      zone.removeEventListener('dragleave', leave);
      zone.removeEventListener('drop', drop);
    };
  }, [addFiles, disabled]);

  const uploading = files.some((f) => f.status === 'uploading');
  const failed = files.some((f) => f.status === 'error');
  const ready = files.filter((f) => f.status === 'done');
  const canSend = !disabled && !uploading && !failed && (value.trim() || ready.length > 0);

  const submit = () => {
    if (!canSend) return;
    speech.cancel();
    onSend(value.trim(), ready.map((f) => ({ ...f.upload, preview: f.preview })));
    // Previews now belong to the sent message; don't revoke them here.
    setFiles([]);
    setValue('');
    setNotice('');
  };

  const toggleVoice = () => {
    if (speech.listening) {
      speech.stop();
      ref.current?.focus();
      return;
    }
    base.current = value && !/\s$/.test(value) ? `${value} ` : value;
    speech.start();
  };

  const status = speech.error || notice
    || (speech.listening ? 'Listening. Click stop or press Esc when you’re done.' : '')
    || (failed ? 'Remove the files that failed to upload, or try them again.' : '');

  return (
    <form
      ref={formRef}
      className={`composer${speech.listening ? ' listening' : ''}`}
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && speech.listening) {
          e.preventDefault();
          speech.stop();
        }
      }}
    >
      {files.length > 0 && (
        <ul className="attach-tray" aria-label="Attachments">
          {files.map((f) => (
            <li key={f.key} className={`attach attach-${f.status}${f.preview ? ' attach-image' : ''}`} title={f.error || `${f.name}, ${formatBytes(f.size)}`}>
              {f.preview ? <img src={f.preview} alt="" /> : (
                <span className="attach-icon" aria-hidden="true">{f.status === 'error' ? <AlertCircle /> : <FileText />}</span>
              )}
              {!f.preview && (
                <span className="attach-text">
                  <span className="attach-name">{f.name}</span>
                  <span className="attach-meta">{f.status === 'error' ? 'Upload failed' : formatBytes(f.size)}</span>
                </span>
              )}
              {f.status === 'uploading' && (
                <span className="attach-progress" role="progressbar" aria-label={`Uploading ${f.name}`} aria-valuenow={Math.round(f.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{ width: `${Math.max(4, f.progress * 100)}%` }} />
                </span>
              )}
              {f.preview && f.status === 'error' && <span className="attach-failed" aria-hidden="true"><AlertCircle /></span>}
              <button type="button" className="attach-remove" onClick={() => removeFile(f.key)} aria-label={`Remove ${f.name}`}><X /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="composer-row">
        <button
          type="button"
          className="mic"
          onClick={() => picker.current?.click()}
          disabled={disabled || files.length >= MAX_FILES}
          aria-label="Attach files"
          title={`Attach images or files (up to ${MAX_FILES})`}
        >
          <Paperclip aria-hidden="true" />
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; ref.current?.focus(); }}
        />
        <textarea
          ref={ref}
          id="question"
          rows={1}
          maxLength={MAX}
          value={value}
          readOnly={speech.listening}
          placeholder={speech.listening ? 'Listening… speak your question' : files.length ? 'Ask about your attachments, or just send' : placeholder}
          aria-label="Your question"
          onChange={(e) => { setValue(e.target.value); speech.clearError(); }}
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData?.files || []);
            if (pasted.length) { e.preventDefault(); addFiles(pasted); }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {speech.supported && (
          <button
            type="button"
            className="mic"
            onClick={toggleVoice}
            disabled={disabled}
            aria-pressed={speech.listening}
            aria-label={speech.listening ? 'Stop voice input' : 'Speak your question'}
            title={speech.listening ? 'Stop voice input (Esc)' : 'Speak your question'}
          >
            {speech.listening ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
          </button>
        )}
        <button type="submit" className="send" disabled={!canSend} aria-label={uploading ? 'Waiting for uploads' : 'Ask'}><ArrowUp /></button>
      </div>
      <p className={`composer-note${speech.error || notice || failed ? ' error' : ''}`} aria-live="polite">{status}</p>
      {dragging && dropTarget && createPortal(
        <div className="dropzone" aria-hidden="true">
          <div className="dropzone-inner">
            <Upload />
            <p>Drop files to attach</p>
            <span>Images, PDFs or text files · up to {MAX_FILES} files</span>
          </div>
        </div>,
        dropTarget,
      )}
    </form>
  );
}

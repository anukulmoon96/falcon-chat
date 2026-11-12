import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function MultiSelect({ label, options, value, onChange, emptyLabel = 'All' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  const trigger = useRef(null);
  const pop = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    // Captured on the document so Escape always closes the menu first; preventDefault keeps
    // a surrounding dialog from treating it as "close the dialog".
    const escape = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape, true);
    // Inside a scrolling dialog the menu can open below the fold; bring it into view.
    pop.current?.scrollIntoView({ block: 'nearest' });
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);

  const shown = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const summary = !value.length ? emptyLabel
    : value.length === 1 ? options.find((o) => o.value === value[0])?.label || '1 selected'
      : `${value.length} selected`;

  return (
    // Tabbing out of the control closes its menu.
    <div className="multi" ref={ref} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <span className="field-label" id={`${id}-label`}>{label}</span>
      <button
        ref={trigger}
        type="button"
        className="multi-trigger"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? `${id}-pop` : undefined}
        disabled={!options.length}
        onClick={() => setOpen((o) => !o)}
      >
        <span id={`${id}-value`}>{options.length ? summary : 'None configured'}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="multi-pop" ref={pop} id={`${id}-pop`} role="group" aria-labelledby={`${id}-label`} tabIndex={-1}>
          {options.length > 8 && (
            <input type="search" placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label.toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          )}
          <ul>
            {shown.map((o) => (
              <li key={o.value}>
                <label className="check"><input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />{o.label}</label>
              </li>
            ))}
          </ul>
          {value.length > 0 && <button type="button" className="link" onClick={() => onChange([])}>Allow all</button>}
        </div>
      )}
    </div>
  );
}

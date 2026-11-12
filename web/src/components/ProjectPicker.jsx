import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { initials } from '../lib/format.js';

// Project switcher: a trigger showing the current project, opening a searchable listbox.
export default function ProjectPicker({ projects, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef(null);
  const trigger = useRef(null);
  const list = useRef(null);
  const id = useId();

  const current = projects.find((p) => p.id === value);
  const searchable = projects.length > 6;
  const shown = projects.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // Without a search box the list itself takes focus for keyboard navigation.
  useEffect(() => {
    if (open && !searchable) list.current?.focus();
  }, [open, searchable]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const show = () => {
    setQuery('');
    setActive(Math.max(0, projects.findIndex((p) => p.id === value)));
    setOpen(true);
  };
  const hide = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const pick = (project) => {
    if (project && project.id !== value) onChange(project.id);
    hide();
  };

  const onKeyDown = (e) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(shown.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Tab') hide(false);
  };

  return (
    <div className="picker" ref={ref} onKeyDown={onKeyDown}>
      <span className="field-label" id={`${id}-label`}>Project</span>
      <button
        ref={trigger}
        type="button"
        className="picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => (open ? hide() : show())}
      >
        <span className="picker-tile" aria-hidden="true">{initials(current?.name)}</span>
        <span className="picker-text" id={`${id}-value`}>
          <span className="picker-name">{current?.name || 'Choose a project'}</span>
          {current?.timezone && <span className="picker-meta">{current.timezone}</span>}
        </span>
        <ChevronsUpDown className="picker-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="picker-pop">
          {searchable && (
            <div className="picker-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                placeholder="Find a project"
                aria-label="Find a project"
                aria-controls={`${id}-list`}
                aria-activedescendant={shown[active] ? `${id}-opt-${active}` : undefined}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                autoFocus
              />
            </div>
          )}
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label="Projects"
            tabIndex={searchable ? -1 : 0}
            aria-activedescendant={shown[active] ? `${id}-opt-${active}` : undefined}
          >
            {shown.map((p, i) => (
              <li
                key={p.id}
                id={`${id}-opt-${i}`}
                data-index={i}
                role="option"
                aria-selected={p.id === value}
                className={`picker-option${i === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
              >
                <span className="picker-tile" aria-hidden="true">{initials(p.name)}</span>
                <span className="picker-text">
                  <span className="picker-name">{p.name}</span>
                  {p.timezone && <span className="picker-meta">{p.timezone}</span>}
                </span>
                {p.id === value && <Check className="picker-check" aria-hidden="true" />}
              </li>
            ))}
            {!shown.length && <li className="picker-empty">No projects match “{query}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

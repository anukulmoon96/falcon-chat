export function Mark({ size = 28 }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#1D232A" />
      <path d="M6.5 21.5 16 8.5l9.5 13-4.4-2.7L16 22.5l-5.1-3.7z" fill="#F2A900" />
    </svg>
  );
}

export function PageHead({ title, subtitle, children }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="page-tools">{children}</div>}
    </header>
  );
}

export function Field({ label, hint, error, className = '', children }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export const Badge = ({ tone = 'neutral', children }) => <span className={`badge badge-${tone}`}>{children}</span>;

// Routine states read as quiet text with a dot; badges are kept for the exceptions.
export const Status = ({ children }) => <span className="status">{children}</span>;

export function Metric({ label, value, tone }) {
  return (
    <div className={`metric${tone ? ` metric-${tone}` : ''}`}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}

export function IconButton({ label, pressed, onClick, disabled, shortcut, children }) {
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut.replace('Arrow', '')} arrow)` : label}
      aria-keyshortcuts={shortcut}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export const Empty = ({ children }) => <p className="empty">{children}</p>;

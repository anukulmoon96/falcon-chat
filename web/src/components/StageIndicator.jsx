import { useEffect, useState } from 'react';

const LABELS = {
  queued: 'Waiting for a free worker',
  starting: 'Reading your question',
  understanding: 'Reading your question',
  analysing: 'Looking at your attachments',
  querying: 'Querying alerts',
  retrying: 'Adjusting the query',
  presenting: 'Writing the answer',
  done: 'Finishing up',
};

// The worker's stages, grouped into the three steps people see.
const STEPS = [
  { label: 'Read question', stages: ['queued', 'starting', 'understanding', 'analysing'] },
  { label: 'Query alerts', stages: ['querying', 'retrying'] },
  { label: 'Write answer', stages: ['presenting', 'done'] },
];

// Progress is shown as steps rather than motion: the label and the steps change as the
// worker reports in, and the timer shows it's still going. Only the label is announced.
export default function StageIndicator({ stage, startedAt }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const current = Math.max(0, STEPS.findIndex((s) => s.stages.includes(stage)));
  return (
    <div className="stage">
      <div className="stage-row">
        <span role="status">{LABELS[stage] || 'Working on it'}…</span>
        <span className="stage-time tabular" aria-hidden="true">{Math.max(0, Math.round((now - startedAt) / 1000))} s</span>
      </div>
      <ol className="stage-steps" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s.label} className={i < current ? 'done' : i === current ? 'current' : undefined} aria-current={i === current ? 'step' : undefined}>
            {s.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

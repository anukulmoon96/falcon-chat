import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Chart from '../../components/Chart.jsx';
import DataTable from '../../components/DataTable.jsx';
import { Empty, Metric, PageHead } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { fmtNumber, fmtSeconds } from '../../lib/format.js';

const PERIODS = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']];
const DAILY = { type: 'line', x: 'day', y: ['questions'] };
const CHANNELS = { type: 'bar', x: 'platform', y: ['questions'] };

export default function Overview() {
  const { projects } = useAuth();
  const [days, setDays] = useState(30);
  const [projectId, setProjectId] = useState('');
  const q = useQuery({
    queryKey: ['overview', days, projectId],
    queryFn: () => api(`/console/overview?days=${days}${projectId ? `&projectId=${projectId}` : ''}`),
  });
  const t = q.data?.totals || {};
  const period = PERIODS.find(([d]) => d === days)?.[1] || `Last ${days} days`;
  const rated = (t.helpful || 0) + (t.unhelpful || 0);

  const daily = useMemo(() => ({ columns: [{ name: 'day', kind: 'text' }, { name: 'questions', kind: 'number' }], rows: q.data?.daily || [] }), [q.data]);
  const channels = useMemo(() => ({ columns: [{ name: 'platform', kind: 'text' }, { name: 'questions', kind: 'number' }], rows: q.data?.byPlatform || [] }), [q.data]);
  const byProject = useMemo(() => ({
    columns: ['project', 'questions', 'users', 'failed', 'tokens'].map((name) => ({ name, kind: name === 'project' ? 'text' : 'number' })),
    rows: q.data?.byProject || [],
  }), [q.data]);

  return (
    <div className="page">
      <PageHead title="Overview" subtitle="How people use Falcon across the web portal, WhatsApp and Teams.">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          {PERIODS.map(([d, label]) => <option key={d} value={d}>{label}</option>)}
        </select>
      </PageHead>
      {q.isError && <p className="form-error">{q.error.message}</p>}
      <div className="metrics">
        <Metric label="Questions" value={fmtNumber(t.questions || 0)} />
        <Metric label="People asking" value={fmtNumber(t.activeUsers || 0)} />
        <Metric label="Average answer time" value={t.avgLatencyMs ? fmtSeconds(t.avgLatencyMs) : '—'} />
        <Metric label="Tokens used" value={fmtNumber((t.inputTokens || 0) + (t.outputTokens || 0))} />
        <Metric label="Rated helpful" value={rated ? `${Math.round((100 * t.helpful) / rated)}%` : '—'} />
        <Metric label="Failed answers" value={fmtNumber(t.failed || 0)} tone={t.failed ? 'danger' : undefined} />
      </div>
      <div className="grid-2">
        <section className="panel">
          <h2>Questions per day</h2>
          {daily.rows.length ? <Chart height={240} chart={DAILY} table={daily} label={`Questions per day, ${period.toLowerCase()}`} /> : <Empty>No questions in this period.</Empty>}
        </section>
        <section className="panel">
          <h2>By channel</h2>
          {channels.rows.length ? <Chart height={240} chart={CHANNELS} table={channels} label={`Questions by channel, ${period.toLowerCase()}`} /> : <Empty>No questions in this period.</Empty>}
        </section>
      </div>
      <section className="panel flush">
        <h2 className="panel-title">By project</h2>
        {byProject.rows.length ? <DataTable table={byProject} /> : <Empty>No questions in this period.</Empty>}
      </section>
    </div>
  );
}

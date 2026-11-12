import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Empty, IconButton, PageHead } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';

const TABS = [['entities', 'Names'], ['glossary', 'Glossary'], ['examples', 'Verified examples'], ['notes', 'Notes and suggestions']];
const KINDS = { events: 'use cases', locations: 'locations', zones: 'zones', cameras: 'cameras' };
const FORMAT = `{
  "events":    [{ "id": "<alert _id>", "name": "Helmet violation" }],
  "locations": [{ "id": "<location _id>", "name": "Plant A" }],
  "zones":     [{ "id": "<zone _id>", "name": "Zone B", "location_id": "<location _id>" }],
  "cameras":   [{ "id": "<camera _id>", "name": "Cam 07", "zone_id": "<zone _id>", "location_id": "<location _id>" }]
}`;

export default function Knowledge() {
  const { projects } = useAuth();
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const knowledge = useQuery({ queryKey: ['knowledge', projectId], queryFn: () => api(`/projects/${projectId}/knowledge`), enabled: Boolean(projectId) });
  return (
    <div className="page">
      <PageHead title="Knowledge" subtitle="The names, terms and verified examples Falcon uses to understand questions about each project.">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </PageHead>
      {!projects.length && <Empty>No projects to configure yet.</Empty>}
      {knowledge.isError && <p className="form-error">{knowledge.error.message}</p>}
      {knowledge.data && <KnowledgeEditor key={projectId} projectId={projectId} initial={knowledge.data} />}
    </div>
  );
}

function useRows(initial, blank) {
  const [rows, setRows] = useState(initial);
  return {
    rows,
    add: () => setRows((r) => [...r, { ...blank }]),
    update: (i, key, value) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [key]: value } : row))),
    remove: (i) => setRows((r) => r.filter((_, j) => j !== i)),
  };
}

function KnowledgeEditor({ projectId, initial }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('entities');
  const [entities, setEntities] = useState(() => JSON.stringify(initial.entities, null, 2));
  const glossary = useRows(initial.glossary, { term: '', meaning: '' });
  const examples = useRows(initial.examples, { question: '', sql: '' });
  const [notes, setNotes] = useState(initial.notes);
  const [suggested, setSuggested] = useState(initial.suggestedQuestions.join('\n'));
  const [status, setStatus] = useState(null);

  const parsed = useMemo(() => {
    try {
      return { value: JSON.parse(entities) };
    } catch {
      return { error: "The names list isn't valid JSON yet." };
    }
  }, [entities]);
  const counts = parsed.value
    ? Object.entries(KINDS).map(([k, label]) => `${(parsed.value[k] || []).length} ${label}`).join(', ')
    : null;

  async function save() {
    if (parsed.error) {
      setTab('entities');
      setStatus({ error: parsed.error });
      return;
    }
    setStatus({ saving: true });
    try {
      await api(`/projects/${projectId}/knowledge`, {
        method: 'PUT',
        body: {
          entities: parsed.value,
          glossary: glossary.rows.filter((r) => r.term.trim() && r.meaning.trim()),
          examples: examples.rows.filter((r) => r.question.trim() && r.sql.trim()),
          notes,
          suggestedQuestions: suggested.split('\n').map((s) => s.trim()).filter(Boolean),
        },
      });
      setStatus({ saved: true });
      queryClient.invalidateQueries({ queryKey: ['knowledge', projectId] });
      queryClient.invalidateQueries({ queryKey: ['suggestions', projectId] });
    } catch (err) {
      const first = err.details?.[0];
      setStatus({ error: first ? `${first.path}: ${first.message}` : err.message });
    }
  }

  return (
    <section className="panel">
      <div className="segmented" role="tablist" aria-label="Knowledge sections">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : undefined} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'entities' && (
        <div className="stack">
          <p className="muted">
            The cameras, locations, zones and use cases of this project, with the MongoDB ids stored in the alerts table.
            Falcon writes SQL with these ids and shows people the names. Paste an export from Alpha in this format:
          </p>
          <pre className="sql">{FORMAT}</pre>
          <textarea className="code-input" rows={16} spellCheck={false} value={entities} onChange={(e) => setEntities(e.target.value)} aria-label="Names as JSON" />
          <p className={parsed.error ? 'field-error' : 'hint'}>{parsed.error || counts}</p>
        </div>
      )}

      {tab === 'glossary' && (
        <div className="stack">
          <p className="muted">Words people use that need explaining, such as "PPE violations" or "night shift".</p>
          {glossary.rows.map((row, i) => (
            <div key={i} className="knowledge-row">
              <input placeholder="Term" value={row.term} onChange={(e) => glossary.update(i, 'term', e.target.value)} aria-label="Term" />
              <input placeholder="What it means" value={row.meaning} onChange={(e) => glossary.update(i, 'meaning', e.target.value)} aria-label="Meaning" />
              <IconButton label="Remove term" onClick={() => glossary.remove(i)}><Trash2 /></IconButton>
            </div>
          ))}
          <div><button type="button" className="btn btn-secondary" onClick={glossary.add}><Plus aria-hidden="true" />Add term</button></div>
        </div>
      )}

      {tab === 'examples' && (
        <div className="stack">
          <p className="muted">Questions with SQL you've checked. Falcon follows these when it gets similar questions, so add one whenever you correct a wrong answer.</p>
          {examples.rows.map((row, i) => (
            <div key={i} className="knowledge-row example">
              <input placeholder="Question" value={row.question} onChange={(e) => examples.update(i, 'question', e.target.value)} aria-label="Question" />
              <textarea className="code-input" rows={3} placeholder="SELECT ..." value={row.sql} onChange={(e) => examples.update(i, 'sql', e.target.value)} aria-label="SQL" spellCheck={false} />
              <IconButton label="Remove example" onClick={() => examples.remove(i)}><Trash2 /></IconButton>
            </div>
          ))}
          <div><button type="button" className="btn btn-secondary" onClick={examples.add}><Plus aria-hidden="true" />Add example</button></div>
        </div>
      )}

      {tab === 'notes' && (
        <div className="stack">
          <label className="field">
            <span className="field-label">Notes about alert_details and this project</span>
            <textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="alert_details keys: confidence (0 to 1), shift (A, B or C), ..." />
          </label>
          <label className="field">
            <span className="field-label">Suggested questions (one per line, shown on the chat home)</span>
            <textarea rows={6} value={suggested} onChange={(e) => setSuggested(e.target.value)} />
          </label>
        </div>
      )}

      <div className="panel-foot">
        <span className={status?.error ? 'text-danger' : 'muted'} role="status">
          {status?.error || (status?.saving ? 'Saving…' : status?.saved ? 'Saved' : '')}
        </span>
        <button type="button" className="btn btn-primary" onClick={save} disabled={status?.saving}>Save knowledge</button>
      </div>
    </section>
  );
}

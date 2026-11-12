import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, ThumbsDown, ThumbsUp } from 'lucide-react';
import InsightCard from '../../components/InsightCard.jsx';
import Modal from '../../components/Modal.jsx';
import { Badge, Empty, PageHead, Status } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { PLATFORMS, fmtDateTime, fmtNumber, fmtSeconds } from '../../lib/format.js';

const PAGE_SIZE = 50;

export default function Conversations() {
  const { projects } = useAuth();
  const [filters, setFilters] = useState({ projectId: '', platform: '', status: '', q: '' });
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const set = (key) => (e) => { setFilters((f) => ({ ...f, [key]: e.target.value })); setPage(1); };
  const params = new URLSearchParams(Object.entries({ ...filters, page: String(page), limit: String(PAGE_SIZE) }).filter(([, v]) => v));
  const list = useQuery({ queryKey: ['conversations', params.toString()], queryFn: () => api(`/console/conversations?${params}`), placeholderData: keepPreviousData });
  const detail = useQuery({ queryKey: ['conversation', openId], queryFn: () => api(`/console/conversations/${openId}`), enabled: Boolean(openId) });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="page">
      <PageHead title="Conversations" subtitle="Every question across channels, with how Falcon understood it and the SQL behind the answer." />
      <div className="toolbar">
        <label className="search">
          <Search aria-hidden="true" />
          <input type="search" placeholder="Search questions" value={filters.q} onChange={set('q')} aria-label="Search questions" />
        </label>
        <select value={filters.projectId} onChange={set('projectId')} aria-label="Project">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={filters.platform} onChange={set('platform')} aria-label="Channel">
          <option value="">All channels</option>
          {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filters.status} onChange={set('status')} aria-label="Result">
          <option value="">All results</option>
          <option value="answered">Answered</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      {list.isError && <p className="form-error">{list.error.message}</p>}
      <section className="panel flush">
        {list.data?.items?.length ? (
          <div className="table-wrap">
            <table className="list-table clickable">
              <thead>
                <tr><th>When</th><th>Person</th><th>Channel</th><th>Project</th><th>Question</th><th>Result</th><th className="num">Time</th><th className="num">Tokens</th><th><span className="sr-only">Rating</span></th></tr>
              </thead>
              <tbody>
                {list.data.items.map((c) => (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    aria-label={`${c.question}, ${c.user}, ${fmtDateTime(c.createdAt)}`}
                    onClick={() => setOpenId(c.id)}
                    // preventDefault: otherwise the same keystroke activates the dialog's Close button as it opens
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(c.id); } }}
                  >
                    <td className="nowrap muted">{fmtDateTime(c.createdAt)}</td>
                    <td>{c.user}</td>
                    <td className="nowrap">{c.platform}</td>
                    <td>{c.project}</td>
                    <td className="cell-question">{c.question}</td>
                    <td>{c.status === 'failed' ? <Badge tone="danger">Failed</Badge> : <Status>Answered</Status>}</td>
                    <td className="num">{fmtSeconds(c.latencyMs)}</td>
                    <td className="num">{fmtNumber(c.tokens)}</td>
                    <td>
                      {c.feedback === 'up' && <ThumbsUp className="rating text-ok" aria-label="Rated helpful" />}
                      {c.feedback === 'down' && <ThumbsDown className="rating text-danger" aria-label="Rated not helpful" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{list.isPending ? 'Loading conversations…' : 'No conversations match these filters.'}</Empty>}
        {list.data && list.data.total > PAGE_SIZE && (
          <div className="pager">
            <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span className="muted tabular">Page {page} of {pages}</span>
            <button type="button" className="btn btn-secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </section>
      <Modal open={Boolean(openId)} onClose={() => setOpenId(null)} title="Conversation" wide>
        {detail.isPending && <p className="muted">Loading…</p>}
        {detail.isError && <p className="form-error">{detail.error.message}</p>}
        {detail.data && <Detail data={detail.data} />}
      </Modal>
    </div>
  );
}

function Detail({ data }) {
  const d = data.detail;
  return (
    <div className="stack">
      <dl className="facts">
        <div><dt>Question</dt><dd>{d.question}</dd></div>
        {d.rephrased && d.rephrased !== d.question && <div><dt>Understood as</dt><dd>{d.rephrased}</dd></div>}
        <div><dt>Channel</dt><dd>{d.platform}</dd></div>
        <div><dt>Answer time</dt><dd>{fmtSeconds(d.latencyMs)}{d.queryMs !== null && d.queryMs !== undefined ? `, query ${fmtSeconds(d.queryMs)}` : ''}</dd></div>
        <div><dt>Tokens</dt><dd>{fmtNumber(d.inputTokens)} in, {fmtNumber(d.outputTokens)} out</dd></div>
        {d.feedback?.comment && <div><dt>Feedback</dt><dd>{d.feedback.comment}</dd></div>}
      </dl>
      {d.error && <p className="form-error">{d.error}</p>}
      {(d.executedSql || d.sql) && (
        <>
          <h3 className="detail-title">SQL that ran</h3>
          <pre className="sql">{d.executedSql || d.sql}</pre>
        </>
      )}
      <h3 className="detail-title">What the person saw</h3>
      <InsightCard message={data.message} readOnly />
    </div>
  );
}

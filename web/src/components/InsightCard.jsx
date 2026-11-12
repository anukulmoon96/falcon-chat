import { useRef, useState } from 'react';
import { BarChart3, Check, Code2, Copy, CornerDownRight, Download, ImageDown, Images, Info, Pencil, Table2, ThumbsDown, ThumbsUp } from 'lucide-react';
import { isChartable } from '@shared/chart-option.js';
import Chart from './Chart.jsx';
import DataTable from './DataTable.jsx';
import Evidence from './Evidence.jsx';
import { IconButton } from './ui.jsx';
import { api } from '../lib/api.js';
import { downloadFile, downloadText, fmtNumber, fmtSeconds, prettyColumn, toCsv } from '../lib/format.js';

const SEVERITY = { high: 'High', medium: 'Medium', low: 'Low', info: 'Note' };

const VIEWS = {
  chart: { label: 'Chart', Icon: BarChart3 },
  evidence: { label: 'Frames', Icon: Images },
  table: { label: 'Table', Icon: Table2 },
};

export default function InsightCard({ message, onAsk, onEditFilter, readOnly = false, showFollowups = true }) {
  const chartRef = useRef(null);
  const chartable = isChartable(message.chart, message.table);
  const hasTable = message.table?.columns?.length > 0 && message.table.rows?.length > 0;
  const hasEvidence = message.evidence?.length > 0;
  const views = [chartable && 'chart', hasEvidence && 'evidence', hasTable && 'table'].filter(Boolean);
  const [view, setView] = useState(message.chart?.type === 'images' && hasEvidence ? 'evidence' : views[0]);
  const [feedback, setFeedback] = useState(message.feedback);
  const [copied, setCopied] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const metricColumn = message.chart?.type === 'number' ? message.chart.y?.[0] : null;
  const metric = metricColumn && message.table?.rows?.length === 1 ? message.table.rows[0][metricColumn] : null;

  async function rate(value) {
    const previous = feedback;
    const next = feedback === value ? null : value;
    setFeedback(next);
    try {
      await api(`/chat/messages/${message.id}/feedback`, { method: 'POST', body: { value: next } });
    } catch {
      setFeedback(previous);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.text || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked by the browser; nothing else to do.
    }
  }

  // An answer that couldn't be given is information, not an alarm.
  if (message.kind === 'error') {
    return <div className="card card-note"><Info aria-hidden="true" /><p>{message.text}</p></div>;
  }
  const isAnswer = message.kind === 'answer' || message.kind === 'analysis';
  const hasMetric = metric !== null && metric !== undefined;

  return (
    <div className="answer">
      <article className={`card insight${isAnswer ? '' : ' plain'}`}>
        {message.filters?.length > 0 && (
          <div className="chips" role="group" aria-label="How the question was read">
            {message.filters.map((f) => (
              <button
                key={`${f.label}:${f.value}`}
                type="button"
                className="chip"
                disabled={readOnly}
                onClick={() => onEditFilter?.(f)}
                title={readOnly ? undefined : `Change the ${f.label.toLowerCase()}`}
              >
                <span className="chip-label">{f.label}</span>{f.value}
                {!readOnly && <Pencil aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}
        {(message.headline || hasMetric || message.summary) && (
          <div className="answer-text">
            {message.headline && <h3 className="headline">{message.headline}</h3>}
            {hasMetric && (
              <p className="metric-big"><span className="metric-big-value">{fmtNumber(metric)}</span><span>{prettyColumn(metricColumn)}</span></p>
            )}
            {message.summary && <p className={message.headline ? 'summary' : 'plain-text'}>{message.summary}</p>}
          </div>
        )}
        {message.findings?.length > 0 && (
          <ul className="findings" aria-label="Findings">
            {message.findings.map((f, i) => (
              <li key={i} className={`finding sev-${f.severity}`}>
                <span className="finding-sev">{SEVERITY[f.severity] || 'Note'}</span>
                <span className="finding-text"><strong>{f.label}</strong>{f.detail && <span>{f.detail}</span>}</span>
              </li>
            ))}
          </ul>
        )}
        {message.clarification && (
          <div className="options">
            {message.clarification.options.map((o) => (
              <button key={o} type="button" className="btn btn-secondary" disabled={readOnly} onClick={() => onAsk?.(o)}>{o}</button>
            ))}
          </div>
        )}
        {views.length > 0 && (
          <div className="views">
            {views.length > 1 && (
              <div className="segmented" role="tablist" aria-label="Ways to view this answer">
                {views.map((v) => {
                  const { label, Icon } = VIEWS[v];
                  return (
                    <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'active' : undefined} onClick={() => setView(v)}>
                      <Icon aria-hidden="true" />{label}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="view">
              {view === 'chart' && <Chart ref={chartRef} chart={message.chart} table={message.table} />}
              {view === 'evidence' && <Evidence items={message.evidence} />}
              {view === 'table' && <DataTable table={message.table} />}
            </div>
          </div>
        )}
        {showSql && message.sql && <pre className="sql">{message.sql}</pre>}
        {isAnswer && (
          <footer className="card-foot">
            <div className="meta">
              {typeof message.meta?.rows === 'number' && <span>{fmtNumber(message.meta.rows)} rows</span>}
              {message.meta?.latencyMs ? <span>Answered in {fmtSeconds(message.meta.latencyMs)}</span> : null}
            </div>
            <div className="actions">
              <IconButton label={copied ? 'Copied' : 'Copy answer'} onClick={copy}>{copied ? <Check /> : <Copy />}</IconButton>
              {hasTable && (
                <IconButton label="Download CSV" onClick={() => downloadText(`falcon-${message.id}.csv`, toCsv(message.table), 'text/csv')}><Download /></IconButton>
              )}
              {/* Stays in place outside the chart view, so the buttons don't shift as views change */}
              {chartable && (
                <IconButton
                  label={view === 'chart' ? 'Download chart' : 'Switch to the chart to download it'}
                  disabled={view !== 'chart'}
                  onClick={() => { const url = chartRef.current?.toPng(); if (url) downloadFile(`falcon-${message.id}.png`, url); }}
                >
                  <ImageDown />
                </IconButton>
              )}
              {message.sql && <IconButton label="View SQL" pressed={showSql} onClick={() => setShowSql((s) => !s)}><Code2 /></IconButton>}
              {!readOnly && (
                <>
                  <span className="actions-divider" aria-hidden="true" />
                  <IconButton label="Helpful" pressed={feedback === 'up'} onClick={() => rate('up')}><ThumbsUp /></IconButton>
                  <IconButton label="Not helpful" pressed={feedback === 'down'} onClick={() => rate('down')}><ThumbsDown /></IconButton>
                </>
              )}
            </div>
          </footer>
        )}
      </article>
      {!readOnly && showFollowups && message.followups?.length > 0 && (
        <div className="followups" role="group" aria-label="Suggested follow-up questions">
          {message.followups.map((q) => (
            <button key={q} type="button" className="followup" onClick={() => onAsk?.(q)}><CornerDownRight aria-hidden="true" />{q}</button>
          ))}
        </div>
      )}
    </div>
  );
}

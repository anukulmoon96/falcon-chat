import { useCallback, useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, PanelLeftClose, PanelLeftOpen, RotateCcw, Search, SquarePen, Trash2, X } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Composer from '../components/Composer.jsx';
import Attachments from '../components/Attachments.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import ProjectPicker from '../components/ProjectPicker.jsx';
import InsightCard from '../components/InsightCard.jsx';
import StageIndicator from '../components/StageIndicator.jsx';
import { Mark } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDateTime, relativeTime } from '../lib/format.js';

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const HISTORY_KEY = 'falcon-chat-history-hidden';
const narrow = () => window.matchMedia('(max-width: 900px)').matches;
const readHistoryHidden = () => {
  try { return localStorage.getItem(HISTORY_KEY) === '1'; } catch { return false; }
};

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

// Wraps each occurrence of `term` in <mark>.
function highlight(text, term) {
  if (!term) return text;
  return String(text).split(new RegExp(`(${escapeRegex(term)})`, 'gi'))
    .map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

// Recent chats grouped by when they were last active, so rows don't each repeat a time.
// Boundaries are calendar days, so daylight-saving changes don't shift them.
function byDay(list) {
  const now = new Date();
  const dayStart = (back) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back).getTime();
  const [today, yesterday, week] = [dayStart(0), dayStart(1), dayStart(7)];
  const groups = [['Today', []], ['Yesterday', []], ['Previous 7 days', []], ['Older', []]];
  for (const t of list) {
    const at = new Date(t.updatedAt).getTime();
    groups[at >= today ? 0 : at >= yesterday ? 1 : at >= week ? 2 : 3][1].push(t);
  }
  return groups.filter(([, items]) => items.length);
}

export default function Chat() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, projects, assistantName } = useAuth();
  const [projectId, setProjectId] = useState(() => {
    const selected = user?.selectedProject?.id;
    return projects.some((p) => p.id === selected) ? selected : projects[0]?.id || '';
  });
  const [pending, setPending] = useState([]);
  const [draft, setDraft] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [historyHidden, setHistoryHidden] = useState(readHistoryHidden);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const searchRef = useRef(null);
  const hideRef = useRef(null);
  const showRef = useRef(null);
  const threadsRef = useRef(null);
  const toggledByUser = useRef(false);
  const listRef = useRef(null);
  const scrolled = useRef({ thread: null, count: 0, pending: 0 });
  const stick = useRef(true);
  const sources = useRef(new Set());

  const threads = useQuery({
    queryKey: ['threads', projectId, query],
    queryFn: () => api(`/chat/threads?projectId=${projectId}${query ? `&q=${encodeURIComponent(query)}` : ''}`),
    enabled: Boolean(projectId),
    placeholderData: keepPreviousData,
  });
  const thread = useQuery({ queryKey: ['thread', threadId], queryFn: () => api(`/chat/threads/${threadId}/messages`), enabled: Boolean(threadId) });
  const suggestions = useQuery({ queryKey: ['suggestions', projectId], queryFn: () => api(`/chat/suggestions?projectId=${projectId}`), enabled: Boolean(projectId) });

  // Opening a thread from another project switches the project with it.
  const threadProject = thread.data?.thread?.projectId;
  useEffect(() => {
    if (threadProject && projects.some((p) => p.id === threadProject)) setProjectId(threadProject);
  }, [threadProject, projects]);

  useEffect(() => () => sources.current.forEach((s) => s.close()), []);

  // Search runs on the server, a moment after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    try { localStorage.setItem(HISTORY_KEY, historyHidden ? '1' : '0'); } catch { /* storage unavailable */ }
  }, [historyHidden]);

  // On wide screens the history panel collapses in place; on narrow ones it's a drawer.
  const toggleHistory = useCallback(() => {
    toggledByUser.current = true;
    if (narrow()) setDrawer((d) => !d);
    else setHistoryHidden((h) => !h);
  }, []);

  // Keep keyboard focus on the counterpart button, since the one pressed disappears.
  useEffect(() => {
    if (!toggledByUser.current) return;
    toggledByUser.current = false;
    if (document.activeElement !== hideRef.current && document.activeElement !== showRef.current) return;
    (historyHidden ? showRef : hideRef).current?.focus();
  }, [historyHidden]);

  // Ctrl/Cmd+K jumps to chat search; Ctrl/Cmd+B shows or hides the history panel.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        setDrawer(true);
        setHistoryHidden(false);
        // Wait a frame so the panel is visible (and focusable) again.
        requestAnimationFrame(() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        });
      } else if (key === 'b') {
        e.preventDefault();
        toggleHistory();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleHistory]);

  // On narrow screens the history drawer behaves like a dialog: focus moves in, Escape
  // closes it, and focus goes back to the button that opened it.
  useEffect(() => {
    if (!drawer || !narrow()) return undefined;
    const panel = threadsRef.current;
    // Next frame: the page behind turns inert first, which drops its focus. Ctrl/Cmd+K may
    // already have put focus in the search box, so only move it if it isn't in the panel.
    requestAnimationFrame(() => { if (!panel?.contains(document.activeElement)) panel?.querySelector('.picker-trigger')?.focus(); });
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); setDrawer(false); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const at = document.activeElement;
      if (!at || at === document.body || panel?.contains(at)) showRef.current?.focus();
    };
  }, [drawer]);

  const messages = thread.data?.messages || [];
  const visible = pending.filter((p) => p.threadId === (threadId || null));
  // Opening or loading a thread jumps straight to its end. Asking a question scrolls down to
  // it gently. An answer arriving scrolls only if the reader is already near the end, so
  // someone looking back at earlier answers isn't pulled away.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const count = messages.length + visible.length;
    const prev = scrolled.current;
    const sameThread = prev.thread === (threadId || null) && prev.count > 0;
    const asked = visible.length > prev.pending;
    scrolled.current = { thread: threadId || null, count, pending: visible.length };
    if (sameThread && !asked && !stick.current) return;
    const smooth = sameThread && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, [threadId, messages.length, visible.length]);

  const project = projects.find((p) => p.id === projectId);
  const patch = (key, fields) => setPending((list) => list.map((p) => (p.key === key ? { ...p, ...fields } : p)));
  const drop = (key) => setPending((list) => list.filter((p) => p.key !== key));

  // Screen readers hear when an answer (or a note that it couldn't be answered) arrives.
  const announce = (message) => setAnnouncement(message.kind === 'error'
    ? message.text
    : `Answer ready. ${message.headline || message.summary || message.text || ''}`);

  function addMessage(tid, message) {
    queryClient.setQueryData(['thread', tid], (old) => {
      if (!old) return { thread: { id: tid, projectId: message.projectId, title: message.question }, messages: [message] };
      if (old.messages.some((m) => m.id === message.id)) return old;
      return { ...old, messages: [...old.messages, message] };
    });
  }

  // Live progress from the worker: stage updates, then the finished answer.
  function listen(taskId, key, tid) {
    const source = new EventSource(`/api/chat/tasks/${taskId}/events`);
    sources.current.add(source);
    const finish = () => { source.close(); sources.current.delete(source); };
    source.addEventListener('stage', (e) => patch(key, { stage: JSON.parse(e.data).stage }));
    source.addEventListener('result', (e) => {
      finish();
      const message = JSON.parse(e.data);
      addMessage(tid, message);
      announce(message);
      drop(key);
      queryClient.invalidateQueries({ queryKey: ['thread', tid] });
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    });
    source.addEventListener('failure', (e) => {
      finish();
      patch(key, { error: JSON.parse(e.data).message });
    });
  }

  async function ask(question, attachments = []) {
    if (!projectId || (!question.trim() && !attachments.length)) return;
    const key = crypto.randomUUID();
    const tid = threadId || null;
    setPending((list) => [...list, { key, question, attachments, threadId: tid, stage: 'queued', startedAt: Date.now() }]);
    try {
      const res = await api('/chat/ask', {
        method: 'POST',
        body: { projectId, question, ...(attachments.length && { attachments: attachments.map((a) => a.id) }), ...(tid ? { threadId: tid } : {}) },
      });
      if (!tid) {
        patch(key, { threadId: res.threadId });
        navigate(`/chat/${res.threadId}`);
      }
      queryClient.invalidateQueries({ queryKey: ['threads', projectId] });
      if (res.message) {
        addMessage(res.threadId, res.message);
        announce(res.message);
        drop(key);
      } else {
        listen(res.taskId, key, res.threadId);
      }
    } catch (err) {
      patch(key, { error: err.message });
    }
  }

  function changeProject(id) {
    setProjectId(id);
    setSearch('');
    setQuery('');
    navigate('/chat');
    api('/auth/project', { method: 'PUT', body: { projectId: id } }).catch(() => {});
  }

  async function removeThread(id) {
    await api(`/chat/threads/${id}`, { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: ['threads', projectId] });
    if (id === threadId) navigate('/chat');
  }

  const retry = (item) => { drop(item.key); ask(item.question, item.attachments); };
  const editFilter = (f) => setDraft(`Same question, but change the ${f.label.toLowerCase()} to `);
  const draftUsed = useCallback(() => setDraft(''), []);

  if (!projects.length) {
    return (
      <div className="page">
        <div className="welcome">
          <Mark size={40} />
          <h2>No projects yet</h2>
          <p className="muted">You don't have any projects assigned. Ask your administrator to add you to one.</p>
        </div>
      </div>
    );
  }

  const threadRow = (t) => (
    <div key={t.id} className={`thread${t.id === threadId ? ' active' : ''}`}>
      <Link
        to={`/chat/${t.id}`}
        aria-current={t.id === threadId ? 'page' : undefined}
        onClick={() => setDrawer(false)}
        title={query ? undefined : `Last active ${fmtDateTime(t.updatedAt)}`}
      >
        <span className="thread-title">{highlight(t.title, query)}</span>
        {t.match && <span className="thread-match">{highlight(t.match, query)}</span>}
        {query && <span className="thread-time">{relativeTime(t.updatedAt)}</span>}
      </Link>
      <button type="button" className="icon-btn thread-delete" aria-label={`Delete "${t.title}"`} onClick={() => setDeleting(t)}>
        <Trash2 aria-hidden="true" />
      </button>
    </div>
  );

  const showWelcome = !threadId && !visible.length;
  return (
    <div className={`chat${historyHidden ? ' history-hidden' : ''}`}>
      <aside ref={threadsRef} id="chat-history" className={`threads${drawer ? ' open' : ''}`} aria-label="Chat history">
        <div className="threads-top">
          <h2 className="sr-only">Chat history</h2>
          <ProjectPicker projects={projects} value={projectId} onChange={changeProject} />
          <button
            ref={hideRef}
            type="button"
            className="icon-btn"
            onClick={toggleHistory}
            aria-controls="chat-history"
            aria-expanded="true"
            aria-label="Hide chat history"
            title={`Hide chat history (${IS_MAC ? '⌘' : 'Ctrl+'}B)`}
          >
            <PanelLeftClose aria-hidden="true" />
          </button>
        </div>
        <div className="threads-head">
          <button type="button" className="new-chat" aria-current={showWelcome ? 'page' : undefined} onClick={() => { setDrawer(false); navigate('/chat'); }}>
            <SquarePen aria-hidden="true" />
            <span>New chat</span>
          </button>
        </div>
        <div className="thread-search" role="search">
          <Search aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search chats"
            aria-label="Search chats"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && search) { e.preventDefault(); setSearch(''); }
            }}
          />
          {search ? (
            <button type="button" className="icon-btn" aria-label="Clear search" onClick={() => { setSearch(''); searchRef.current?.focus(); }}>
              <X aria-hidden="true" />
            </button>
          ) : <kbd aria-hidden="true">{IS_MAC ? '⌘K' : 'Ctrl K'}</kbd>}
        </div>
        {/* Search status is announced; without a search the day headings below do the labeling. */}
        <p className={`thread-list-label${query ? '' : ' sr-only'}`} aria-live="polite">
          {!query ? 'Recent chats'
            : threads.isFetching ? 'Searching…'
              : `${threads.data?.length || 0} ${threads.data?.length === 1 ? 'result' : 'results'}`}
        </p>
        <div className={`thread-list${threads.isFetching && query ? ' stale' : ''}`}>
          {threads.data?.length ? (query ? threads.data.map(threadRow) : byDay(threads.data).map(([label, items]) => (
            <section key={label} className="thread-group">
              <h3 className="thread-list-label">{label}</h3>
              {items.map(threadRow)}
            </section>
          ))) : query ? (
            <div className="thread-empty">
              <Search aria-hidden="true" />
              <p>No chats match “{query}”</p>
              <span>Try a different word, or check the project you're in.</span>
            </div>
          ) : <p className="muted small pad">Your conversations about {project?.name} will appear here.</p>}
        </div>
      </aside>
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete chat?"
        onConfirm={() => removeThread(deleting.id)}
        onClose={() => setDeleting(null)}
      >
        <p>“{deleting?.title}” will be removed from your chat history. You won't be able to open it again.</p>
      </ConfirmDialog>
      {drawer && <button type="button" className="scrim" aria-label="Close conversations" onClick={() => setDrawer(false)} />}

      {/* While the narrow-screen drawer is open, the conversation behind it can't be reached */}
      <section className="conversation" inert={drawer && narrow() ? true : undefined}>
        <header className="conversation-head">
          {/* Shown while the panel is hidden (wide screens) and always on narrow screens, where it opens the drawer. */}
          <div className={`conversation-tools${historyHidden ? '' : ' only-narrow'}`}>
            <button
              ref={showRef}
              type="button"
              className="icon-btn"
              onClick={toggleHistory}
              aria-controls="chat-history"
              aria-expanded="false"
              aria-label="Show chat history"
              title={`Show chat history (${IS_MAC ? '⌘' : 'Ctrl+'}B)`}
            >
              <PanelLeftOpen aria-hidden="true" />
            </button>
            {!showWelcome && (
              <button type="button" className="icon-btn" onClick={() => navigate('/chat')} aria-label="New chat" title="New chat">
                <SquarePen aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="conversation-title">
            <h1>{showWelcome ? 'New chat' : (threadId && thread.data?.thread?.title) || project?.name}</h1>
            <p>{project?.name}{project?.timezone ? ` · times in ${project.timezone}` : ''}</p>
          </div>
        </header>

        <div
          className="messages"
          ref={listRef}
          onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160; }}
        >
          {showWelcome ? (
            <div className="welcome">
              <Mark size={40} />
              <h2>Ask {assistantName} about {project?.name}</h2>
              <p className="muted">Answers come with charts, tables and the camera frames behind them.</p>
              <div className="suggestions">
                {(suggestions.data || []).map((s) => <button key={s} type="button" className="suggestion" onClick={() => ask(s)}>{s}</button>)}
              </div>
            </div>
          ) : (
            <div className="thread-body">
              {thread.isError && <p className="form-error">{thread.error.message}</p>}
              {messages.map((m, i) => (
                <div key={m.id} className="exchange">
                  <Attachments items={m.attachments} />
                  <p className="bubble">{m.question}</p>
                  {/* Follow-up suggestions only under the newest answer, so older ones don't pile up */}
                  <InsightCard message={m} onAsk={ask} onEditFilter={editFilter} showFollowups={i === messages.length - 1} />
                </div>
              ))}
              {visible.map((p) => (
                <div key={p.key} className="exchange">
                  <Attachments items={p.attachments} />
                  {p.question && <p className="bubble">{p.question}</p>}
                  {p.error ? (
                    <div className="card card-error" role="alert">
                      <AlertCircle aria-hidden="true" />
                      <p>{p.error}</p>
                      <button type="button" className="btn btn-secondary" onClick={() => retry(p)}><RotateCcw aria-hidden="true" />Try again</button>
                    </div>
                  ) : <StageIndicator stage={p.stage} startedAt={p.startedAt} />}
                </div>
              ))}
            </div>
          )}
        </div>

        <Composer onSend={ask} disabled={!projectId} projectId={projectId} placeholder={`Ask about ${project?.name || 'your sites'}`} draft={draft} onDraftUsed={draftUsed} />
        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      </section>
    </div>
  );
}

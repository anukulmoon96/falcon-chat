import { BookOpen, Database, History, LayoutDashboard, LogOut, MessageSquare, Monitor, Moon, Sun, Users } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { ROLE_LABELS, initials } from '../lib/format.js';
import { useTheme } from '../lib/theme.js';
import { Mark } from './ui.jsx';

const THEMES = {
  system: { next: 'light', label: 'Theme: system', Icon: Monitor },
  light: { next: 'dark', label: 'Theme: light', Icon: Sun },
  dark: { next: 'system', label: 'Theme: dark', Icon: Moon },
};

export default function AppShell() {
  const { user, can, logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const navigate = useNavigate();
  const onChat = useLocation().pathname.startsWith('/chat');
  const theme = THEMES[preference] || THEMES.system;
  const ThemeIcon = theme.Icon;

  const consoleLinks = [
    { to: '/console', label: 'Overview', Icon: LayoutDashboard, show: can('usage.view'), end: true },
    { to: '/console/users', label: 'Users', Icon: Users, show: can('users.view') },
    { to: '/console/projects', label: 'Projects', Icon: Database, show: can('projects.manage') },
    { to: '/console/knowledge', label: 'Knowledge', Icon: BookOpen, show: can('knowledge.manage') },
    { to: '/console/conversations', label: 'Conversations', Icon: History, show: can('conversations.view') },
  ].filter((l) => l.show);

  const link = ({ to, label, Icon, end }) => (
    <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
      <Icon aria-hidden="true" /><span>{label}</span>
    </NavLink>
  );

  return (
    <div className="shell">
      {/* First stop for keyboard users: on chat pages, straight to the question box */}
      <a
        className="skip-link"
        href={onChat ? '#question' : '#main'}
        onClick={(e) => {
          const target = document.getElementById(onChat ? 'question' : 'main');
          if (target) { e.preventDefault(); target.focus(); }
        }}
      >
        {onChat ? 'Skip to question box' : 'Skip to main content'}
      </a>
      <aside className="rail">
        <div className="brand"><Mark size={28} /><span className="brand-name">Falcon</span></div>
        <nav className="nav" aria-label="Main">
          {link({ to: '/chat', label: 'Chat', Icon: MessageSquare })}
          {consoleLinks.length > 0 && <p className="nav-section"><span>Console</span></p>}
          {consoleLinks.map(link)}
        </nav>
        <div className="rail-foot">
          <button type="button" className="nav-link" onClick={() => setPreference(theme.next)}>
            <ThemeIcon aria-hidden="true" /><span>{theme.label}</span>
          </button>
          <NavLink to="/account" className={({ isActive }) => `nav-link who${isActive ? ' active' : ''}`}>
            <span className="avatar" aria-hidden="true">{initials(user?.name)}</span>
            <span className="who-text">
              <span className="who-name">{user?.name}</span>
              <span className="who-role">{ROLE_LABELS[user?.role] || ''}</span>
            </span>
          </NavLink>
          <button type="button" className="nav-link" onClick={async () => { await logout(); navigate('/login', { replace: true }); }}>
            <LogOut aria-hidden="true" /><span>Sign out</span>
          </button>
        </div>
      </aside>
      <main className="main" id="main" tabIndex={-1}><Outlet /></main>
    </div>
  );
}

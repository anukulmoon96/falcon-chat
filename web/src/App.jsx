import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell.jsx';
import { Mark } from './components/ui.jsx';
import { useAuth } from './lib/auth.jsx';
import Account from './pages/Account.jsx';
import Chat from './pages/Chat.jsx';
import Login from './pages/Login.jsx';
import Conversations from './pages/console/Conversations.jsx';
import Knowledge from './pages/console/Knowledge.jsx';
import Overview from './pages/console/Overview.jsx';
import Projects from './pages/console/Projects.jsx';
import Users from './pages/console/Users.jsx';

export default function App() {
  const { status, user, can } = useAuth();
  if (status === 'loading') return <div className="boot" aria-busy="true"><Mark size={40} /></div>;

  const signedIn = status === 'authenticated';
  const home = user?.mustChangePassword ? '/account' : '/chat';
  return (
    <Routes>
      <Route path="/login" element={signedIn ? <Navigate to={home} replace /> : <Login />} />
      <Route element={signedIn ? <AppShell /> : <Navigate to="/login" replace />}>
        <Route index element={<Navigate to={home} replace />} />
        {/* One route for both, so Chat stays mounted (and keeps listening) when a new thread gets its id */}
        <Route path="chat/:threadId?" element={<Chat />} />
        <Route path="account" element={<Account />} />
        {can('console.view') && (
          <Route path="console" element={can('usage.view') ? <Overview /> : <Navigate to="/console/conversations" replace />} />
        )}
        {can('users.view') && <Route path="console/users" element={<Users />} />}
        {can('projects.manage') && <Route path="console/projects" element={<Projects />} />}
        {can('knowledge.manage') && <Route path="console/knowledge" element={<Knowledge />} />}
        {can('conversations.view') && <Route path="console/conversations" element={<Conversations />} />}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}

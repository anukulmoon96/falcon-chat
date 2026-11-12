import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { HttpError, logger } from './lib/http.js';
import { authenticate } from './auth/session.js';
import { authRouter } from './routes/auth.js';
import { chatRouter } from './routes/chat.js';
import { accountsRouter } from './routes/accounts.js';
import { projectsRouter } from './routes/projects.js';
import { consoleRouter } from './routes/console.js';
import { mediaRouter } from './routes/media.js';
import { whatsappRouter } from './channels/whatsapp.js';
import { teamsRouter } from './channels/teams.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'blob:'] } },
    // Chart and evidence links are opened by Teams and WhatsApp clients.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // WhatsApp needs the raw body for its signature check, so it goes before express.json().
  app.use('/webhooks/whatsapp', whatsappRouter);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api/teams', teamsRouter);
  app.use('/media', mediaRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/chat', authenticate, chatRouter);
  app.use('/api/accounts', authenticate, accountsRouter);
  app.use('/api/projects', authenticate, projectsRouter);
  app.use('/api/console', authenticate, consoleRouter);
  app.use('/api', () => {
    throw new HttpError(404, 'Not found.');
  });

  // In production the built web app is served from here (same origin, so the
  // session cookie and the event stream need no CORS setup).
  const webDir = config.serveWebDir && path.resolve(config.serveWebDir);
  if (webDir && fs.existsSync(path.join(webDir, 'index.html'))) {
    app.use('/assets', express.static(path.join(webDir, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(webDir, { index: false }));
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(webDir, 'index.html')) : next()));
  }

  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) logger.error({ err: err.message, stack: err.stack, path: req.path }, 'Request failed');
    if (res.headersSent) return res.end();
    return res.status(status).json({
      error: status >= 500 ? 'Something went wrong on our side. Try again.' : err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  });
  return app;
}

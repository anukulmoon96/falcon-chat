# Falcon

Falcon lets Company's clients ask about their CCTV safety alerts in plain language and get answers as numbers, charts, tables and the camera frames behind them, on the **web portal**, **WhatsApp** or **Microsoft Teams**. It runs on the existing Falcon MongoDB (`accounts`, `projects`, `conversations`, `tasks`) and each project's MySQL `alerts` table.

- **Web portal** (Vite + React): chat with answer cards (chart, table and evidence views, the interpretation as editable chips, follow-up suggestions, CSV and PNG export, feedback) and a console for admins and sub-admins (overview, users, projects, knowledge, conversations).
- **API and worker** (Node.js + Express): sign-in, roles and per-project data scopes, the question pipeline (Gemini → SQL guard → MySQL → presentation) and a task queue on the existing `tasks` collection.
- **Channels**: Web Portal, WhatsApp Cloud API and Microsoft Teams, allowed per person by `accounts.platformShared`.

## Layout

```
falcon/
├── server/             API, worker and channels (Node.js, Express)
│   ├── src/ai/         Gemini prompts and the question pipeline
│   ├── src/sql/        SQL guard (validation, row cap, data scope) and result shaping
│   ├── src/channels/   WhatsApp, Teams and shared quick commands
│   ├── src/routes/     REST API for the portal and console
│   ├── scripts/        Demo seed data and read-only MySQL grants
│   └── test/           Guard, shaping and end-to-end pipeline tests
├── web/                Web portal and console (Vite, React)
├── shared/             Chart builder used by the portal and by server-side chart images
├── docker/             Demo MySQL database (about 24,000 synthetic alerts)
├── teams-app/          Teams app manifest and icons
├── Dockerfile
└── docker-compose.yml
```

## Quick start with Docker

1. `cp server/.env.example server/.env`, then set `GEMINI_API_KEY` and a long random `JWT_SECRET` (`openssl rand -base64 48`).
2. `docker compose up -d --build`
3. `docker compose exec falcon node scripts/seed.js --samples` prints sign-in details for an admin, a sub-admin and an end user who can only see Plant A.
4. Open http://localhost:4000 and ask "Which zone had the most helmet violations last week?"

## Local development

Needs Node.js 20.12 or later (22 LTS recommended), MongoDB and MySQL. `docker compose up -d mongo mysql` starts both with the demo database.

```bash
cd server
cp .env.example .env            # set GEMINI_API_KEY and JWT_SECRET
npm install
npm run seed -- --samples       # demo project, knowledge and sign-ins
npm run dev                     # API and worker on http://localhost:4000

cd ../web
npm install
npm run dev                     # portal on http://localhost:5173 (proxies /api and /media)
```

## Connecting your existing Falcon data

No migration is needed. The new code reads the current documents and adds fields as it goes.

| Collection | How it's used | Fields it adds |
|---|---|---|
| `accounts` | People. `platformShared` decides their channels, `mobileNumber` matches WhatsApp senders, `selectedProject` and `isProjectSelectionOn` drive the WhatsApp and Teams project picker. | `passwordHash`, `mustChangePassword`, `sessionVersion`, `dataScopes`, `teams`, `isActive`, `lastLoginAt` |
| `projects` | `name` and `db_name` | `timezone`, `isActive`, `description` |
| `conversations` | One document per question, keeping the original fields (`question`, `rephrased_question`, `query`, `response`, tokens, `message_id`, `user_id`, `username`) | `platform`, `project_id`, `account_id`, `thread_id`, `status`, `result`, `executed_sql`, `latency_ms`, `feedback` |
| `tasks` | The queue. The worker only takes tasks with `source: "falcon-v2"`, so tasks from the current system are left alone. | |
| `threads`, `knowledge`, `audit_logs` | New: web chat threads, per-project names and terms, admin actions | |

Before going live:

1. Point `MONGO_URI` and `MONGO_DB` at the Falcon database.
2. Give each project a time zone in **Console → Projects**. "Today", "last week" and hourly answers use it.
3. Load each project's names in **Console → Knowledge**: the ids and names of its use cases, locations, zones and cameras from Alpha's MongoDB. Falcon writes SQL with the ids and shows people the names.
4. Create one read-only MySQL user per project: `npm run grants > grants.sql`, run that file as a MySQL admin, and store the printed `MYSQL_PROJECT_CREDENTIALS` in your secrets manager.
5. Existing accounts don't have a web password yet. An admin opens **Console → Users → Edit → Reset password** and shares the temporary password; the person sets their own after signing in. Role values are read as `admin`, `sub_admin` (or `subadmin`), and anything else is treated as an end user.
6. Add the indexes from `docker/mysql/init/01-demo.sql` to each project's `alerts` table. The ID columns are `TEXT`, so the indexes need prefix lengths.

## Roles

| | Admin | Sub-admin | End user |
|---|---|---|---|
| Ask questions | Any project | Assigned projects | Assigned projects, within their data scope |
| Overview, conversations, SQL | All projects | Assigned projects | |
| Manage users | Everyone | End users in their projects, never beyond their own projects, channels or data scope | |
| Projects and database settings | Yes | | |
| Knowledge | All projects | Assigned projects | |

A data scope limits a person to chosen locations, zones, cameras or use cases inside a project. Admins can always open the web portal, so nobody can lock everyone out.

## Channels and `platformShared`

Each person's `platformShared` lists where they can chat: `"Web Portal"`, `"WhatsApp"` and `"Teams"`. It's checked at web sign-in, on every WhatsApp and Teams message, and again by the worker before answering. All channels understand `projects` (switch project), `current` and `help`, and greetings are answered without calling Gemini.

### WhatsApp (Meta Cloud API)

1. In Meta for Developers, add WhatsApp to your app and note the phone number ID, a permanent system-user token and the app secret.
2. Set the webhook callback URL to `https://<your-host>/webhooks/whatsapp` with your `WHATSAPP_VERIFY_TOKEN`, and subscribe to the `messages` field.
3. Set `WHATSAPP_ENABLED=true` and the `WHATSAPP_*` values. `PUBLIC_BASE_URL` must be your public HTTPS address, because WhatsApp downloads evidence frames from it.
4. People are matched by `accounts.mobileNumber`: country code and number, digits only, the way WhatsApp sends it.

Falcon only replies to messages people send, within WhatsApp's customer-service window, so no message templates are needed. Scheduled or proactive reports would need approved templates.

### Microsoft Teams

1. Create an Azure Bot resource (single tenant), note its app ID and tenant ID, and create a client secret.
2. Set the messaging endpoint to `https://<your-host>/api/teams/messages` and enable the Microsoft Teams channel.
3. Set `TEAMS_ENABLED=true`, `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD` and `TEAMS_TENANT_ID`.
4. In `teams-app/manifest.json`, replace `{{TEAMS_APP_ID}}` and `{{PUBLIC_HOST}}`, zip `manifest.json`, `color.png` and `outline.png` together, and upload the zip in Teams or the Teams admin center.

People are linked on their first message by matching their Teams work email to `accounts.email`. Falcon talks to the Bot Connector REST API directly and verifies the token on every incoming request, so it doesn't depend on the archived Bot Framework SDK.

## How a question is answered

1. The channel checks the person, their channel access and the project, then queues a task.
2. The worker builds the prompt: the `alerts` schema, the project's names limited to the person's data scope, its glossary and verified examples, the project's local date and time, and recent turns.
3. Gemini (`GEMINI_SQL_MODEL`) returns its interpretation, one SQL statement and a chart suggestion as JSON.
4. The SQL guard parses the statement and accepts only a single `SELECT` over `alerts` with no database prefix, comments, variables or locking. It caps the rows and, for people with a data scope, adds a CTE named `alerts` that holds only the rows they may see.
5. MySQL runs it as the project's read-only user, in a read-only session, in the project's time zone, with a timeout. If it fails, Gemini gets one retry with the error.
6. IDs are turned into names, and Gemini (`GEMINI_FAST_MODEL`) writes the headline and summary from statistics computed in code. Numbers in charts and tables come from the query, not the model.
7. The answer is saved to `conversations` and sent back: live progress over server-sent events on the portal, text plus a chart image and frames on WhatsApp, an Adaptive Card on Teams.

## Tests

```bash
cd server
npm test        # guard and shaping tests

# With the demo database loaded, also run the end-to-end pipeline test:
FALCON_MYSQL_TEST=1 MYSQL_HOST=127.0.0.1 \
MYSQL_PROJECT_CREDENTIALS='{"LLM_DEMO_DB":{"user":"falcon_ro","password":"falcon_ro_dev"}}' npm test
```

## Production notes

- Serve over HTTPS and set `COOKIE_SECURE=true`.
- To scale, run extra workers with `npm run worker` and set `WORKER_ENABLED=false` on the API instances.
- Keep `JWT_SECRET`, the Gemini key, MySQL credentials and the WhatsApp and Teams secrets in a secrets manager.
- Evidence and chart links are signed and expire after `MEDIA_TOKEN_TTL_HOURS`. `MEDIA_ALLOWED_HOSTS` limits where evidence images are fetched from.

## Not built yet

Scheduled reports and threshold alerts (WhatsApp templates), pinned dashboards, an Arabic right-to-left interface, single sign-on, and an "Ask Falcon" panel inside Alpha.

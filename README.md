# FileHub AI

> Часть экосистемы **[MindTagSystem](https://github.com/tagiriskaliev18-hash/MindTagSystem)** · автор **Тагир Искалиев** ([@tagiriskaliev18-hash](https://github.com/tagiriskaliev18-hash))

Corporate web platform for file storage, an AI agent that edits Office files via natural language, compression-to-target-size, and format conversion — built as an MVP slice of the full ТЗ (see `ТЗ_веб-платформа_с_ИИ-агентом.docx`). See the sections below for what's implemented vs. deferred.

Licensed under the [MIT License](LICENSE).

## Stack

Node.js/TypeScript monorepo (npm workspaces, Node 20+):

- **apps/api** — Express backend, SQLite (via Prisma), local-disk file storage, in-process job worker
- **apps/web** — React + Vite + Tailwind frontend
- **packages/shared** — shared TypeScript types and zod schemas (`@filehub/shared`)

Docker is optional. Local development runs the API and the Vite dev server as two processes. A production image (and the Render Node deploy) serves the built SPA and the API from one process on one port.

## Architecture

```text
browser
  │
  ├─ apps/web  React SPA (Vite dev server on :5173, or static files in production)
  │
  └─ apps/api  Express on :4000
        ├─ /api/auth      email/password, httpOnly JWT cookie
        ├─ /api/files     folders, upload, versions, trash, share links
        ├─ /api/jobs      DB-backed queue; in-process poller runs compress/convert
        ├─ /api/compress  target size (MB / KB / %)
        ├─ /api/convert   format matrix from packages/shared
        ├─ /api/agent     Office/PDF tools, diff preview before save
        ├─ /api/admin     users, quotas, audit log, conversion toggles
        ├─ /s             share-link download
        └─ /health
              │
              ├─ SQLite (Prisma)     users, files, versions, jobs, audit, settings
              ├─ storage/            file bytes (StorageAdapter; local disk today)
              └─ AI provider         Anthropic, or any OpenAI-compatible LocalAI
```

`packages/shared` is the contract both sides validate against: roles, job states, request schemas, and `CONVERSION_MATRIX` / `categoryForMime`. The API re-checks those schemas; the web client imports the same types.

In production (`NODE_ENV=production`, Docker, or Render) `createApp()` serves `apps/web/dist` from the API process when that folder exists. The page and the API are same-origin, so the session cookie is sent without a `VITE_API_URL`. In local dev the two servers stay separate: the web app calls `http://<page-host>:4000`.

The job worker is a loop inside the API process (no Redis). The storage adapter is a small `put/get/delete` interface over a directory so a later S3/MinIO swap does not touch callers. Object keys are `ownerId/fileId/version` (and `drafts/...` for unsaved agent edits) and are resolved inside `STORAGE_ROOT`.

The agent does not run arbitrary code. It calls a fixed tool list (`toolRegistry.ts`) chosen from the MIME types of the files attached to the chat. Edits are proposed as a diff and written as a new file version only after the user applies them. Signed documents are blocked until `check_document_signatures` has been called for that file and reported no signatures.

Without an AI provider the process still starts. File management, compression, and conversion keep working; chat returns a degradation response (`aiEnabled` on `/health`).

## Local development

Requirements: Node.js 20 or newer, npm. LibreOffice is optional and only needed for Office ↔ PDF and PDF ↔ image conversion. Audio/video uses the `ffmpeg` / `ffprobe` binaries shipped with the npm dependencies; you do not install them separately.

```bash
npm install
cp .env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
npm run prisma:migrate
npm run dev
```

Frontend: http://localhost:5173 · API: http://localhost:4000

The first registered user automatically becomes an administrator.

Useful scripts from the repo root:

| Script | What it does |
|---|---|
| `npm run dev` | API (`tsx watch`) and Vite together |
| `npm test` | Vitest unit tests (API, web, shared) |
| `npm run lint` | ESLint (TypeScript) |
| `npm run typecheck` | `tsc --noEmit` for shared, API, and web, including tests |
| `npm run build` | Compile shared, API, and the web production bundle |
| `npm start` | Run the compiled API (`apps/api/dist/server.js`) |
| `npm run share` | Production server plus a localtunnel URL |

Generate the Prisma client on its own with `npm run prisma:generate -w apps/api` (CI does this before typecheck and build). `DATABASE_URL` must be set for Prisma CLI commands; the example file uses `file:./dev.db`.

### AI agent (optional)

Add your key to `apps/api/.env` (never commit that file):

```
ANTHROPIC_API_KEY=sk-ant-...
```

`sk-ant-...` is a placeholder shape, not a usable key. Without a real key the app runs in **degradation mode**: the file manager, compression, and conversion all work normally; only the AI chat is disabled (with a banner explaining why), per ТЗ §4.2.

To keep document text on your own network, set `AI_PROVIDER=localai` plus `LOCALAI_BASE_URL` and `LOCALAI_MODEL` instead of an Anthropic key. The tool loop is the same; `localAiClient.ts` translates it to the OpenAI chat-completions format.

### PDF/Office conversion (optional)

DOCX/PPTX/XLSX → PDF, PDF → DOCX, and PDF ↔ image all require LibreOffice on the server (auto-detected at request time):

```bash
# Windows
winget install TheDocumentFoundation.LibreOffice

# Debian/Ubuntu
sudo apt-get install libreoffice-writer libreoffice-calc libreoffice-impress
```

PDF → PPTX/XLSX is deliberately not offered: LibreOffice opens a PDF as a fixed drawing with no import path into Calc or Impress, so there's no reliable way to reconstruct a slide deck or spreadsheet from one this way — only Writer has a dedicated PDF-import filter, which is what makes PDF → DOCX possible.

All other conversions (images, audio/video, XLSX↔CSV, ZIP) work without LibreOffice.

## Tests and CI

Vitest runs unit tests for the logic that does not need a live database or LibreOffice: shared zod schemas and the conversion matrix, CIDR allowlist, JWT issue/verify, auth middleware, share-link ACL and expiry, compression target math, OOXML text replacement, agent tool dispatch (signature gate), storage key containment, LocalAI message translation, upload-filename repair, DTO mapping, and the web API client, formatters, job polling, and route guards.

```bash
npm test
npm run lint
npm run typecheck
```

GitHub Actions (`.github/workflows/ci.yml`) runs, on every pull request and on pushes to `main`: install, `prisma generate`, lint, typecheck, test, and build. The workflow uses Node 20.

## Docker

The `Dockerfile` is a multi-stage Node 20 bookworm-slim build. The runtime image includes LibreOffice Writer, Calc, and Impress, runs `prisma migrate deploy`, and starts `node dist/server.js` as one process on port 4000. SQLite and uploaded bytes live on volumes so they survive a new container:

- `/app/apps/api/prisma` — SQLite file next to `schema.prisma`
- `/app/storage` — object bytes

Named volumes hide files baked into the image, including new Prisma migrations. The image keeps a second copy at `/app/prisma-migrations-src` and copies any migrations the volume is missing into place before `migrate deploy`.

`docker/network-ca.crt` is a **public CA certificate** (not a private key) for a TLS-intercepting gateway on some networks. The image copies it so `npm` during the build and outbound HTTPS at runtime can trust that gateway. It is not an application secret. Leave it in the repo; the Dockerfile `COPY`s it.

`NODE_ENV=production` is set in the image, so the container **refuses to start** until `JWT_SECRET` is a unique value (see [Environment variables](#environment-variables)).

```bash
docker build -t filehub-ai .
docker run --rm -p 4000:4000 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e DATABASE_URL="file:./dev.db" \
  -v filehub-db:/app/apps/api/prisma \
  -v filehub-storage:/app/storage \
  filehub-ai
```

Open http://localhost:4000 . Optional: `-e ANTHROPIC_API_KEY=...` or the `LOCALAI_*` variables. Do not pass secrets with `ENV` instructions in the Dockerfile or commit them in a compose file.

`render.docker.yaml` is the same image on Render (`env: docker`).

## Deploy on Render

Two blueprints:

| File | How Render builds it |
|---|---|
| `render.yaml` | Native Node. Build: `npm install --include=dev && npm run prisma:generate -w apps/api && npm run build`. Start: `npm run prisma:deploy -w apps/api && npm start`. |
| `render.docker.yaml` | `Dockerfile` in this repo. |

1. Push the repository to GitHub. `.gitignore` excludes `.env`, SQLite files, and `storage/` contents.
2. In the [Render dashboard](https://render.com), choose **New → Blueprint** and select this repo.
3. Render reads `render.yaml` (or use `render.docker.yaml` if you create a Docker web service). `JWT_SECRET` is generated (`generateValue: true`). `NODE_ENV=production` and `DATABASE_URL=file:./dev.db` are set in the blueprint.
4. Add `ANTHROPIC_API_KEY` or the LocalAI variables in the service **Environment** tab if you want the agent. Leave `ALLOWED_CIDRS` empty for a public URL.
5. Open the service URL Render assigns (`https://filehub-ai-….onrender.com`).

Free-tier notes:

- The service sleeps after about 15 minutes without traffic and takes roughly half a minute to wake.
- The free disk is ephemeral. A restart drops the SQLite file and `storage/` unless you attach a persistent disk or move the database off the instance later.
- The first account registered on that instance is the administrator.

A shorter Russian walkthrough of the same hosting steps is in [DEPLOY.md](DEPLOY.md).

## Environment variables

Nothing in the repo is a live credential. `.env.example` and `apps/web/.env.example` are templates. Real values belong in `apps/api/.env`, `apps/web/.env`, the shell, or the host's secret store. Those files are gitignored.

When `NODE_ENV=production`, startup throws if `JWT_SECRET` is missing or equal to either published placeholder (`change-this-to-a-long-random-string` from the example file, or the built-in dev fallback). Local development (`NODE_ENV` unset or not `production`) still boots without a `.env` so the dev server keeps a stable signing key across restarts. Do not deploy that fallback.

### API (`apps/api/.env`, process environment)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `4000` | HTTP port |
| `NODE_ENV` | no | unset (treated as development) | `production` enables secure cookies and the JWT secret check |
| `JWT_SECRET` | yes in production | dev-only fallback | HMAC secret for the session JWT. Unique random value in production |
| `SESSION_COOKIE_NAME` | no | `fh_session` | Session cookie name |
| `DATABASE_URL` | yes for Prisma | `file:./dev.db` in the examples | SQLite URL, relative to `schema.prisma` |
| `STORAGE_ROOT` | no | `../../storage` (from `apps/api`) | Directory for file bytes |
| `ALLOWED_CIDRS` | no | empty (allow all) | Comma-separated IPv4 CIDRs. Empty disables the network check |
| `ANTHROPIC_API_KEY` | no | empty | Enables the agent when `AI_PROVIDER=anthropic` |
| `ANTHROPIC_MODEL` | no | `claude-sonnet-5` | Model id for the Anthropic path |
| `AI_PROVIDER` | no | `anthropic` | `anthropic` or `localai` |
| `LOCALAI_BASE_URL` | with localai | empty | OpenAI-compatible base URL, no trailing slash required |
| `LOCALAI_API_KEY` | no | empty | Bearer token for LocalAI, if that server requires one |
| `LOCALAI_MODEL` | with localai | empty | Model name on that server |
| `LOCALAI_TIMEOUT_MS` | no | `300000` | Abort one LocalAI completion after this many milliseconds |
| `AGENT_PDF_MAX_PAGES` | no | `6` | Scanned-PDF pages sent to the model per read |
| `AGENT_PDF_IMAGE_SCALE` | no | `1.5` | Render scale for those page images |
| `AGENT_PDF_IMAGE_QUALITY` | no | `65` | JPEG quality for those page images |

`aiEnabled` is true when the selected provider has the variables it needs: an Anthropic key, or both `LOCALAI_BASE_URL` and `LOCALAI_MODEL`.

### Web (`apps/web/.env`)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `VITE_API_URL` | no | in dev, `http://<page-hostname>:4000`; in a production build, `""` (same origin) | Set only when the API is served from a different host than the page. A hardcoded host breaks the `SameSite=Lax` session cookie |

Vite inlines `VITE_*` at **build** time. Changing it for a Docker/Render build means rebuilding the web bundle.

## What's implemented

- Auth (email/password, JWT session), roles (User/Admin), IP/CIDR allowlist middleware as a stand-in for real corporate SSO/ZTNA (`ALLOWED_CIDRS` env var)
- File manager: folders, upload (drag-drop/multi), rename/move/trash/restore, search by name, version history with restore, in-org share links
- AI agent: chat tied to a file, reads/edits DOCX (text replace, append paragraph), PPTX (edit/add/remove/reorder slides), XLSX (cells, formulas, sheets), creates new files from a description, diff preview before any change is saved as a new file version
- Compression to a target size (MB/KB/%): images, audio/video, PDF (JPEG-image recompression), Office docs (recompresses embedded images), archives
- Conversion: images any↔any, audio/video any↔any, XLSX↔CSV, ZIP wrap, Office→PDF, PDF→DOCX, image↔PDF (last three LibreOffice-gated)
- Admin panel: users/roles/quotas/blocking, audit log, usage stats, per-format conversion enable/disable
- Job queue: DB-backed table + in-process poller (no Redis needed for single-instance use)

## Deliberately deferred (see the plan for full rationale)

- Real corporate SSO/MFA/ZTNA (needs the customer's IT decision — ТЗ §10)
- Postgres + S3/MinIO + Redis/BullMQ (the storage/queue code sits behind small adapter interfaces specifically so swapping these in later doesn't touch calling code)
- Full-document search (name search only), email notifications (in-app job-completion toasts only), arbitrary-code-execution sandboxing (the agent only calls a fixed whitelisted tool set, which sidesteps the need for one)
- Uploads are buffered in memory, capped at 500MB (not the ТЗ's 2GB target) — true multi-GB uploads need a streaming storage adapter rewrite

## Known limitations in the AI agent's document editing

- `replace_text` (docx) and `edit_slide_text` (pptx) match text across Word/PowerPoint's run-fragmentation boundaries, but a replaced phrase adopts the formatting of its *first* run rather than preserving mixed formatting mid-phrase
- PDF compression only recompresses JPEG-filtered embedded images (the common case); raw/Flate-encoded image streams are left untouched
- `add_slide` clones the previous slide as a template; on very unusual slide layouts it falls back to treating the first two text shapes as title/body

---

## 🌐 Часть экосистемы MindTagSystem

FileHub AI входит в **[MindTagSystem](https://github.com/tagiriskaliev18-hash/MindTagSystem)** — экосистему для программистов, которую создаёт **Тагир Искалиев** ([@tagiriskaliev18-hash](https://github.com/tagiriskaliev18-hash)): своя операционная система, браузер, IDE, ИИ-ядро и приложения, которые работают вместе и которые можно встроить в любое устройство.

**Роль в экосистеме:** облачное хранилище с ИИ-агентом (слой «Приложения»).

| Слой | Проект | Что делает |
|---|---|---|
| Платформа | [AIsktagOS](https://github.com/tagiriskaliev18-hash/AisktagOS) | Операционная система для разработчиков в стиле macOS на любом железе |
| Инструменты разработчика | [Mind IDE](https://github.com/tagiriskaliev18-hash/Mind-IDE) | ИИ-среда разработки: один чат с моделями, Claude Code и Antigravity |
| Инструменты разработчика | [ITIS Browser](https://github.com/tagiriskaliev18-hash/ITIS-browser) | Браузер с ИИ-агентом, который сам кликает и листает страницы |
| ИИ-ядро | [AI Duo (multimodel-agent)](https://github.com/tagiriskaliev18-hash/multimodel-agent) | Единый ИИ-шлюз с OpenAI-совместимым API для всех моделей |
| ИИ-ядро | [Antigravity ↔ Claude Code Bridge](https://github.com/tagiriskaliev18-hash/antigravity-claude-bridge) | MCP-мост, который связывает Antigravity, Claude Code и пул моделей |
| ИИ-ядро | [Qwen 14B Coder Dev](https://github.com/tagiriskaliev18-hash/qwen14b-coder-dev) | Локальная офлайн-модель для программирования в Ollama |
| Приложения | [MindMail](https://github.com/tagiriskaliev18-hash/MindMail) | Все почтовые ящики в одном и лучшее из Gmail, Mail.ru, Outlook и Яндекс Почты |
| Приложения | **FileHub AI** ← вы здесь | Хранилище файлов с ИИ-агентом для Word, PowerPoint и Excel |
| Приложения | [SortApp (анализатор логов)](https://github.com/tagiriskaliev18-hash/sortapp) | Анализатор журналов доступа к сетевым папкам с отчётами Excel |
| Приложения | [ИИ Доктор (medical-ai-assistant)](https://github.com/tagiriskaliev18-hash/medical-ai-assistant) | Офлайн-ассистент врача приёмного покоя |

Как проекты связаны между собой: [архитектура MindTagSystem](https://github.com/tagiriskaliev18-hash/MindTagSystem/blob/main/docs/ARCHITECTURE.md). Автор всех проектов экосистемы — Тагир Искалиев.

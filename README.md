# FileHub AI

Corporate web platform for file storage, an AI agent that edits Office files via natural language, compression-to-target-size, and format conversion — built as an MVP slice of the full ТЗ (see `ТЗ_веб-платформа_с_ИИ-агентом.docx`). See `context.md`-style notes below for what's implemented vs. deferred.

## Stack

Node.js/TypeScript monorepo (npm workspaces), no Docker required:

- **apps/api** — Express backend, SQLite (via Prisma), local-disk file storage, in-process job worker
- **apps/web** — React + Vite + Tailwind frontend
- **packages/shared** — shared TypeScript types/zod schemas

## Setup

```bash
npm install
cp .env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
npm run prisma:migrate
npm run dev
```

Frontend: http://localhost:5173 · API: http://localhost:4000

The first registered user automatically becomes an administrator.

### AI agent (optional)

Add your key to `apps/api/.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Without it, the app runs in **degradation mode**: the file manager, compression, and conversion all work normally; only the AI chat is disabled (with a banner explaining why), per ТЗ §4.2.

### PDF/Office conversion (optional)

DOCX/PPTX/XLSX → PDF, PDF → DOCX, and PDF ↔ image all require LibreOffice on the server (auto-detected at request time):

```bash
winget install TheDocumentFoundation.LibreOffice
```

PDF → PPTX/XLSX is deliberately not offered: LibreOffice opens a PDF as a fixed
drawing with no import path into Calc or Impress, so there's no reliable way
to reconstruct a slide deck or spreadsheet from one this way — only Writer
has a dedicated PDF-import filter, which is what makes PDF → DOCX possible.

All other conversions (images, audio/video, XLSX↔CSV, ZIP) work without LibreOffice.

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

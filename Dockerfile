# Multi-stage build for the whole FileHub AI monorepo (api + web + shared)
# into a single runnable image. Debian-slim (not alpine) because sharp/bcrypt
# ship prebuilt native bindings for glibc, not musl.

FROM node:20-bookworm-slim AS builder
WORKDIR /app

# This network intercepts outbound TLS with its own CA (KZ state gateway,
# visible on any HTTPS connection leaving this network) — trust it
# system-wide so npm/prisma's own binary downloads succeed during the build.
COPY docker/network-ca.crt /usr/local/share/ca-certificates/network-ca.crt
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY . .
RUN npm run prisma:generate -w apps/api
RUN npm run build
# packages/shared's package.json points "main" at raw src/index.ts — fine for
# tsx/vite, which transpile TS on the fly, but plain `node` (the runtime
# image's CMD) can't load a .ts file directly. Compile a JS copy here and
# point a runtime-only package.json at it below, instead of changing the
# real package.json (which would force every local dev run through a build
# step just to pick up shared-type edits).
RUN npm run build -w packages/shared
RUN node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('./packages/shared/package.json')); p.main='./dist/index.js'; p.types='./dist/index.d.ts'; delete p.scripts; delete p.devDependencies; fs.writeFileSync('./packages/shared/package.json', JSON.stringify(p, null, 2));"

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
# Matches apps/api/prisma/schema.prisma's datasource — the SQLite file ends
# up at apps/api/prisma/dev.db (Prisma resolves it relative to schema.prisma,
# not cwd). Override with `docker run -e DATABASE_URL=...` if needed.
ENV DATABASE_URL="file:./dev.db"

# openssl: Prisma's query engine needs it to self-detect its ABI at startup —
# without it, it defaults to a guess and tries to download a replacement
# engine binary over the network instead, which both shouldn't be necessary
# and would fail without the CA trust below anyway.
# ca-certificates + network CA: this network intercepts outbound TLS with its
# own CA (KZ state gateway) — needed at runtime too, for the AI agent's calls
# to the Anthropic API to succeed.
# libreoffice-writer/calc/impress (not the full libreoffice meta-package,
# which also drags in Draw/Base/Math and extra language packs): gates
# Office->PDF, PDF->DOCX, and PDF<->image conversion (see libreoffice.ts) —
# was missing entirely from this image, so every one of those conversions
# failed at runtime despite working in local dev, where it's installed
# separately on the host.
COPY docker/network-ca.crt /usr/local/share/ca-certificates/network-ca.crt
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates openssl \
      libreoffice-writer libreoffice-calc libreoffice-impress \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/packages/shared ./packages/shared
# A second, non-volume-mounted copy of the migrations that ship in *this*
# image — see the CMD below for why. Keep this copy step directly after the
# one above so both always reflect the same build, never two different ones.
COPY --from=builder /app/apps/api/prisma/migrations /app/prisma-migrations-src

WORKDIR /app/apps/api
EXPOSE 4000

# /app/storage: uploaded file bytes (StorageAdapter root, see env.ts).
# /app/apps/api/prisma: the SQLite db file lives next to schema.prisma.
# Without volumes here, every `docker run` starts from an empty database.
VOLUME ["/app/storage", "/app/apps/api/prisma"]

# Mounting the whole prisma/ directory as a volume (needed to persist the
# sqlite file across container recreation) has a sharp edge: the *first*
# container to ever use that named volume seeds it from the image's
# prisma/ at that point in time, and every later container just sees
# whatever's already in the volume — new migrations shipped in a newer
# image never become visible there, because the volume mount shadows them.
# `prisma migrate deploy` then silently reports "no pending migrations"
# even when the image has new ones the database has never seen. Copying
# from the non-volume /app/prisma-migrations-src (added above) into the
# live, volume-backed migrations/ directory before every deploy keeps it in
# sync with whatever image is actually running; -n never overwrites an
# already-applied migration's files, only adds ones the volume is missing.
CMD ["sh", "-c", "cp -rn /app/prisma-migrations-src/. /app/apps/api/prisma/migrations/ && npx prisma migrate deploy --schema prisma/schema.prisma && node dist/server.js"]

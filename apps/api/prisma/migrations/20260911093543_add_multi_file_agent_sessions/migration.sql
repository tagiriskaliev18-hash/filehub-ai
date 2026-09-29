-- CreateTable
CREATE TABLE "agent_session_files" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_session_files_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_session_files_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_agent_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_sessions_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_sessions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_agent_sessions" ("createdAt", "createdById", "fileId", "id") SELECT "createdAt", "createdById", "fileId", "id" FROM "agent_sessions";
DROP TABLE "agent_sessions";
ALTER TABLE "new_agent_sessions" RENAME TO "agent_sessions";
CREATE INDEX "agent_sessions_fileId_idx" ON "agent_sessions"("fileId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "agent_session_files_sessionId_idx" ON "agent_session_files"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_session_files_sessionId_fileId_key" ON "agent_session_files"("sessionId", "fileId");

-- Backfill: every pre-existing session had exactly one file via the old
-- required fileId column — carry that into the new join table so those
-- sessions don't silently end up with zero attached files once the app
-- switches to treating agent_session_files as the source of truth.
INSERT INTO "agent_session_files" ("id", "sessionId", "fileId")
SELECT lower(hex(randomblob(16))), "id", "fileId" FROM "agent_sessions" WHERE "fileId" IS NOT NULL;

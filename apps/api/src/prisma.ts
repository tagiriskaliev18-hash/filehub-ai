import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// SQLite defaults to zero busy-timeout: any write that overlaps another
// (e.g. the job worker's frequent progress updates racing a file upload's
// audit-log write) throws "database is locked" immediately instead of
// waiting a moment for the other write to finish. That's the exact failure
// mode behind uploads that show an error in the UI while the file — and its
// audit entry — were already committed successfully just before the request
// handler's own write collided and threw. WAL mode lets reads proceed
// without blocking on a writer, and the busy_timeout makes a genuinely
// overlapping write retry for up to 5s instead of failing instantly.
async function configureSqlite() {
  // Both PRAGMAs return the value they were just set to as a one-row result
  // set, which SQLite's $executeRawUnsafe rejects ("Execute returned
  // results") — $queryRawUnsafe is the variant that accepts a result set.
  await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
}

export const sqliteReady = configureSqlite();

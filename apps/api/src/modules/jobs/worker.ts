import * as jobsService from "./jobs.service.js";
import { compressOneFile } from "../compression/compression.service.js";
import { convertOneFile } from "../conversion/conversion.service.js";
import { writeAudit } from "../../lib/audit.js";
import type { CompressRequestInput, ConvertRequestInput } from "@filehub/shared";

const POLL_INTERVAL_MS = 1000;

// DB-backed queue + in-process poller — no Redis needed for a single-instance
// MVP deployment. Swap this loop for BullMQ workers later without touching
// the compression/conversion services, which just take a fileId and return a result.
async function processJob(jobId: string) {
  const job = await jobsService.getOwnedJobUnsafe(jobId);
  const payload = JSON.parse(job.payloadJson);

  // Combines each file's own 0-100 progress with its position in the batch,
  // and only writes to the DB when the rounded overall percentage actually
  // changes — ffmpeg alone can fire several progress events per second, and
  // there's no point polling/writing faster than a UI could ever show.
  let lastWritten = -1;
  const makeProgressReporter = (fileCount: number, fileIndex: number) => (filePct: number) => {
    const overall = Math.round(((fileIndex + filePct / 100) / fileCount) * 100);
    if (overall !== lastWritten) {
      lastWritten = overall;
      void jobsService.updateJobProgress(jobId, overall);
    }
  };

  try {
    if (job.type === "compress") {
      const input = payload as CompressRequestInput;
      const results = [];
      for (let i = 0; i < input.fileIds.length; i++) {
        const r = await compressOneFile(input.fileIds[i], input, makeProgressReporter(input.fileIds.length, i));
        results.push(r);
      }
      await jobsService.completeJob(jobId, { results });
      await writeAudit({ userId: job.createdById, action: "compress.done", targetType: "Job", targetId: jobId });
    } else if (job.type === "convert") {
      const input = payload as ConvertRequestInput;
      const results = [];
      for (let i = 0; i < input.fileIds.length; i++) {
        const r = await convertOneFile(input.fileIds[i], input.targetFormat, makeProgressReporter(input.fileIds.length, i));
        results.push(r);
      }
      await jobsService.completeJob(jobId, { results });
      await writeAudit({ userId: job.createdById, action: "convert.done", targetType: "Job", targetId: jobId });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Неизвестная ошибка обработки";
    await jobsService.failJob(jobId, message);
    await writeAudit({ userId: job.createdById, action: `${job.type}.failed`, targetType: "Job", targetId: jobId, meta: { message } });
  }
}

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const job = await jobsService.claimNextQueuedJob();
    if (job) await processJob(job.id);
  } catch (err) {
    console.error("Job worker tick failed:", err);
  } finally {
    running = false;
  }
}

export function startJobWorker() {
  setInterval(tick, POLL_INTERVAL_MS);
  console.log("Job worker started (in-process poller)");
}

import { useEffect, useState } from "react";
import type { JobDto } from "@filehub/shared";
import { api } from "../lib/api";

// Polls a single job until it leaves the queued/running state — used by the
// compress/convert wizards to show a live progress bar instead of just
// closing the dialog and leaving the user to guess whether anything happened.
export function useJobPolling(jobId: string | null): JobDto | null {
  const [job, setJob] = useState<JobDto | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const latest = await api.getJob(jobId!);
        if (cancelled) return;
        setJob(latest);
        if (latest.status === "queued" || latest.status === "running") {
          timer = setTimeout(poll, 400);
        }
      } catch {
        // transient network error — try again on the next tick
        if (!cancelled) timer = setTimeout(poll, 1000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  return job;
}

export function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
      <div
        className="fh-progress h-2 rounded-full transition-all duration-300 ease-out"
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { JobDto } from "@filehub/shared";
import { api } from "./api";

export interface JobNotification {
  job: JobDto;
  seenAt: number;
}

// Polls /api/jobs and surfaces newly-completed jobs as notifications — this
// doubles as the ТЗ §5.6 "notify when a long background operation finishes"
// requirement without a separate notifications table/websocket for the MVP.
export function useJobsPolling(enabled: boolean) {
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [notifications, setNotifications] = useState<JobNotification[]>([]);
  const knownStatus = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function poll() {
      try {
        const { jobs: latest } = await api.listJobs();
        if (cancelled) return;
        setJobs(latest);
        for (const job of latest) {
          const prevStatus = knownStatus.current.get(job.id);
          if (prevStatus && prevStatus !== job.status && (job.status === "done" || job.status === "failed")) {
            setNotifications((prev) => [{ job, seenAt: Date.now() }, ...prev].slice(0, 20));
          }
          knownStatus.current.set(job.id, job.status);
        }
      } catch {
        // transient network error — next poll will retry
      }
    }

    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  function dismiss(jobId: string) {
    setNotifications((prev) => prev.filter((n) => n.job.id !== jobId));
  }

  return { jobs, notifications, dismiss };
}

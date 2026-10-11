// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { JobDto } from "@filehub/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { useJobsPolling } from "./useJobsPolling";

vi.mock("./api", () => ({
  api: { listJobs: vi.fn() },
}));

function job(id: string, status: JobDto["status"]): JobDto {
  return {
    id,
    type: "compress",
    status,
    progress: status === "done" ? 100 : 10,
    createdAt: "2026-01-01T00:00:00.000Z",
    resultJson: null,
    errorMessage: status === "failed" ? "boom" : null,
  };
}

describe("useJobsPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.listJobs).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not notify on the first observation, including a job that is already done", async () => {
    vi.mocked(api.listJobs).mockResolvedValue({ jobs: [job("a", "done")] });
    const { result } = renderHook(() => useJobsPolling(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.notifications).toEqual([]);
  });

  it("notifies when a known job finishes or fails, and dismiss removes it", async () => {
    vi.mocked(api.listJobs)
      .mockResolvedValueOnce({ jobs: [job("a", "running"), job("b", "running")] })
      .mockResolvedValue({ jobs: [job("a", "done"), job("b", "failed")] });

    const { result } = renderHook(() => useJobsPolling(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.notifications).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.notifications.map((entry) => entry.job.id).sort()).toEqual(["a", "b"]);
    expect(result.current.notifications.map((entry) => entry.job.status).sort()).toEqual(["done", "failed"]);

    act(() => result.current.dismiss("a"));
    expect(result.current.notifications.map((entry) => entry.job.id)).toEqual(["b"]);
  });

  it("does not poll while disabled", async () => {
    renderHook(() => useJobsPolling(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(api.listJobs).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { act, render, renderHook } from "@testing-library/react";
import type { JobDto } from "@filehub/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { ProgressBar, useJobPolling } from "./JobProgress";

vi.mock("../lib/api", () => ({
  api: { getJob: vi.fn() },
}));

function job(status: JobDto["status"], progress: number): JobDto {
  return {
    id: "job-1",
    type: "convert",
    status,
    progress,
    createdAt: "2026-01-01T00:00:00.000Z",
    resultJson: null,
    errorMessage: null,
  };
}

describe("ProgressBar", () => {
  it("clamps the width to 0–100", () => {
    const { container, rerender } = render(<ProgressBar percent={150} />);
    const bar = container.querySelector(".fh-progress") as HTMLElement;
    expect(bar.style.width).toBe("100%");
    rerender(<ProgressBar percent={-10} />);
    expect(bar.style.width).toBe("0%");
    rerender(<ProgressBar percent={40} />);
    expect(bar.style.width).toBe("40%");
  });
});

describe("useJobPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.getJob).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls until the job leaves the queue and stops after that", async () => {
    vi.mocked(api.getJob)
      .mockResolvedValueOnce(job("running", 20))
      .mockResolvedValueOnce(job("done", 100));

    const { result } = renderHook(() => useJobPolling("job-1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current?.progress).toBe(20);
    expect(api.getJob).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current?.status).toBe("done");
    expect(api.getJob).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(api.getJob).toHaveBeenCalledTimes(2);
  });

  it("retries after a network error and clears when there is no job", async () => {
    vi.mocked(api.getJob).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(job("queued", 0));
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useJobPolling(id), {
      initialProps: { id: "job-1" as string | null },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current?.status).toBe("queued");

    rerender({ id: null });
    expect(result.current).toBeNull();
  });
});

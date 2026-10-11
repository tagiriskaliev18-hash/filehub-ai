import { describe, expect, it } from "vitest";
import { formatBytes, formatDate } from "./format";

describe("formatBytes", () => {
  it("uses Russian unit labels and one decimal above bytes", () => {
    expect(formatBytes(0)).toBe("0 Б");
    expect(formatBytes(512)).toBe("512 Б");
    expect(formatBytes(1024)).toBe("1.0 КБ");
    expect(formatBytes(1536)).toBe("1.5 КБ");
    expect(formatBytes(1024 * 1024)).toBe("1.0 МБ");
    expect(formatBytes(1024 ** 3)).toBe("1.0 ГБ");
    expect(formatBytes(1024 ** 4)).toBe("1.0 ТБ");
  });
});

describe("formatDate", () => {
  it("formats an ISO timestamp for ru-RU", () => {
    const formatted = formatDate("2026-03-05T15:04:00.000Z");
    expect(formatted).toMatch(/2026/);
    expect(formatted.length).toBeGreaterThan(4);
  });
});

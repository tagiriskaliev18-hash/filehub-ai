import { describe, expect, it, vi } from "vitest";

vi.mock("../../prisma.js", () => ({
  prisma: {},
  sqliteReady: Promise.resolve(),
}));

import { fixUploadFilename } from "./files.routes.js";

describe("fixUploadFilename", () => {
  it("recovers a UTF-8 filename that multer decoded as Latin-1", () => {
    const original = "Отчёт №1.docx";
    const mangled = Buffer.from(original, "utf8").toString("latin1");
    expect(mangled).not.toBe(original);
    expect(fixUploadFilename(mangled)).toBe(original);
  });

  it("leaves an ASCII filename unchanged", () => {
    expect(fixUploadFilename("report.docx")).toBe("report.docx");
  });
});

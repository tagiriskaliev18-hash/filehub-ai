import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("../../prisma.js", () => ({
  prisma: { settings: { findUnique } },
  sqliteReady: Promise.resolve(),
}));

import { CONVERSION_MATRIX } from "@filehub/shared";
import { getDisabledConversions, getEffectiveConversionMatrix } from "./settings.service.js";

describe("conversion settings", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("returns the full matrix when nothing has been disabled", async () => {
    findUnique.mockResolvedValue(null);
    await expect(getDisabledConversions()).resolves.toEqual([]);
    const matrix = await getEffectiveConversionMatrix();
    expect(matrix).toEqual(CONVERSION_MATRIX);
  });

  it("removes disabled category:format pairs and keeps the rest", async () => {
    findUnique.mockResolvedValue({ value: JSON.stringify(["image:pdf", "pdf:docx", "unknown:nope"]) });
    await expect(getDisabledConversions()).resolves.toEqual(["image:pdf", "pdf:docx", "unknown:nope"]);
    const matrix = await getEffectiveConversionMatrix();
    expect(matrix.image).not.toContain("pdf");
    expect(matrix.image).toContain("png");
    expect(matrix.pdf).toEqual(["jpg", "png"]);
    expect(matrix.document).toEqual(["pdf"]);
  });
});

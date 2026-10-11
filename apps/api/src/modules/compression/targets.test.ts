import { describe, expect, it } from "vitest";
import { categorize, extOf, resolveTargetBytes, stripExt, suffixName } from "./targets.js";

describe("categorize", () => {
  it("picks a compressor family from the MIME type", () => {
    expect(categorize("image/jpeg")).toBe("image");
    expect(categorize("video/webm")).toBe("video");
    expect(categorize("audio/wav")).toBe("audio");
    expect(categorize("application/pdf")).toBe("pdf");
    expect(categorize("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("office");
    expect(categorize("application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe("office");
    expect(categorize("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("office");
    expect(categorize("application/zip")).toBe("archive");
    expect(categorize("text/plain")).toBe("unsupported");
  });
});

describe("resolveTargetBytes", () => {
  it("converts MB, KB, and percent into a byte budget", () => {
    expect(resolveTargetBytes("MB", 1.5, 999)).toBe(Math.round(1.5 * 1024 * 1024));
    expect(resolveTargetBytes("KB", 10, 999)).toBe(10 * 1024);
    expect(resolveTargetBytes("PERCENT", 50, 1000)).toBe(500);
    expect(resolveTargetBytes("PERCENT", 33, 1000)).toBe(330);
  });
});

describe("compressed filenames", () => {
  it("keeps the last extension and suffixes the base name", () => {
    expect(extOf("Photo.JPEG")).toBe("jpeg");
    expect(extOf("README")).toBe("");
    expect(stripExt("archive.tar.gz")).toBe("archive.tar");
    expect(suffixName("report.docx", "-compressed")).toBe("report-compressed.docx");
    expect(suffixName("archive.tar.gz", "-compressed")).toBe("archive.tar-compressed.gz");
    expect(suffixName("README", "-compressed")).toBe("README-compressed");
  });
});

import { describe, expect, it } from "vitest";
import {
  CONVERSION_MATRIX,
  agentMessageSchema,
  categoryForMime,
  compressRequestSchema,
  convertRequestSchema,
  loginSchema,
  registerSchema,
} from "./index.js";

describe("categoryForMime", () => {
  it("maps each supported family and rejects unknown types", () => {
    expect(categoryForMime("application/pdf")).toBe("pdf");
    expect(categoryForMime("image/png")).toBe("image");
    expect(categoryForMime("audio/mpeg")).toBe("audio");
    expect(categoryForMime("video/mp4")).toBe("video");
    expect(categoryForMime("text/csv")).toBe("spreadsheet");
    expect(categoryForMime("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("spreadsheet");
    expect(categoryForMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("document");
    expect(categoryForMime("application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe(
      "presentation",
    );
    expect(categoryForMime("application/zip")).toBe("archive");
    expect(categoryForMime("text/plain")).toBeNull();
    expect(categoryForMime("application/octet-stream")).toBeNull();
  });
});

describe("CONVERSION_MATRIX", () => {
  it("does not offer PDF to slide or spreadsheet reconstruction", () => {
    expect(CONVERSION_MATRIX.pdf).toEqual(["docx", "jpg", "png"]);
    expect(CONVERSION_MATRIX.pdf).not.toContain("pptx");
    expect(CONVERSION_MATRIX.pdf).not.toContain("xlsx");
    expect(CONVERSION_MATRIX.document).toEqual(["pdf"]);
    expect(CONVERSION_MATRIX.presentation).toEqual(["pdf"]);
    expect(CONVERSION_MATRIX.spreadsheet).toEqual(["xlsx", "csv", "pdf"]);
  });

  it("only lists formats for categories categoryForMime can return", () => {
    const produced = new Set(
      [
        "application/pdf",
        "image/png",
        "audio/mpeg",
        "video/mp4",
        "text/csv",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/zip",
      ].map((mime) => categoryForMime(mime)),
    );
    for (const category of Object.keys(CONVERSION_MATRIX)) {
      expect(produced.has(category)).toBe(true);
    }
  });
});

describe("request schemas", () => {
  it("accepts a normal registration and rejects a bad email or empty password", () => {
    expect(registerSchema.safeParse({ email: "a@example.com", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
    expect(registerSchema.safeParse({ email: "a@example.com", password: "" }).success).toBe(false);
  });

  it("requires a positive compression target and at least one file", () => {
    expect(
      compressRequestSchema.safeParse({ fileIds: ["f1"], targetValue: 1.5, targetUnit: "MB" }).success,
    ).toBe(true);
    expect(
      compressRequestSchema.safeParse({ fileIds: [], targetValue: 10, targetUnit: "KB" }).success,
    ).toBe(false);
    expect(
      compressRequestSchema.safeParse({ fileIds: ["f1"], targetValue: 0, targetUnit: "PERCENT" }).success,
    ).toBe(false);
    expect(
      compressRequestSchema.safeParse({ fileIds: ["f1"], targetValue: 10, targetUnit: "GB" }).success,
    ).toBe(false);
  });

  it("caps an agent message at 4000 characters", () => {
    expect(agentMessageSchema.safeParse({ content: "привет" }).success).toBe(true);
    expect(agentMessageSchema.safeParse({ content: "" }).success).toBe(false);
    expect(agentMessageSchema.safeParse({ content: "x".repeat(4001) }).success).toBe(false);
    expect(convertRequestSchema.safeParse({ fileIds: ["f1"], targetFormat: "pdf" }).success).toBe(true);
    expect(convertRequestSchema.safeParse({ fileIds: ["f1"], targetFormat: "" }).success).toBe(false);
  });
});

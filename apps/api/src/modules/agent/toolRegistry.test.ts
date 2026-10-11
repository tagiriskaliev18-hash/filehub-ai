import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentToolContext, AttachedFileState } from "./toolRegistry.js";

vi.mock("./tools/docx.js", () => ({
  readDocxText: vi.fn(),
  replaceDocxText: vi.fn(),
  appendDocxParagraph: vi.fn(),
}));
vi.mock("./tools/pptx.js", () => ({
  listSlides: vi.fn(),
  editSlideText: vi.fn(),
  setSlideTitleAndBody: vi.fn(),
  addSlide: vi.fn(),
  removeSlide: vi.fn(),
  reorderSlides: vi.fn(),
}));
vi.mock("./tools/xlsx.js", () => ({
  listSheetNames: vi.fn(),
  readSheet: vi.fn(),
  setCell: vi.fn(),
  setFormula: vi.fn(),
  addSheet: vi.fn(),
}));
vi.mock("./tools/pdf.js", () => ({
  readPdfText: vi.fn(),
  renderPdfPagesAsImages: vi.fn(),
}));

import * as docxTools from "./tools/docx.js";
import { categoryForFile, dispatchTool, getToolsForCategories } from "./toolRegistry.js";

function fileState(overrides: Partial<AttachedFileState> = {}): AttachedFileState {
  return {
    fileId: "file-1",
    name: "Doc.docx",
    category: "docx",
    buffer: Buffer.from("original"),
    changeLog: [],
    proposedSummary: null,
    ...overrides,
  };
}

function ctxOf(file: AttachedFileState): AgentToolContext {
  return { files: new Map([[file.fileId, file]]) };
}

describe("categoryForFile", () => {
  it("recognises the four agent document types", () => {
    expect(categoryForFile("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("docx");
    expect(categoryForFile("application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe("pptx");
    expect(categoryForFile("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("xlsx");
    expect(categoryForFile("application/pdf")).toBe("pdf");
    expect(categoryForFile("image/png")).toBe("unsupported");
  });
});

describe("getToolsForCategories", () => {
  it("always offers listing, the signature check, and file creation", () => {
    const names = getToolsForCategories(new Set()).map((tool) => tool.name);
    expect(names).toEqual(["list_attached_files", "check_document_signatures", "create_file_from_description"]);
  });

  it("adds propose_diff once for editable Office files and never for a PDF-only chat", () => {
    const pdf = getToolsForCategories(new Set(["pdf"])).map((tool) => tool.name);
    expect(pdf).toContain("read_pdf_text");
    expect(pdf).not.toContain("propose_diff");
    expect(pdf).not.toContain("replace_text");

    const mixed = getToolsForCategories(new Set(["docx", "pptx", "xlsx"])).map((tool) => tool.name);
    expect(mixed.filter((name) => name === "propose_diff")).toHaveLength(1);
    expect(new Set(mixed).size).toBe(mixed.length);
    expect(mixed).toContain("replace_text");
    expect(mixed).toContain("list_slides");
    expect(mixed).toContain("set_cell");
  });
});

describe("dispatchTool", () => {
  beforeEach(() => {
    vi.mocked(docxTools.replaceDocxText).mockReset();
  });

  it("lists attached files", async () => {
    const file = fileState();
    const listed = await dispatchTool("list_attached_files", {}, ctxOf(file));
    expect(JSON.parse(listed as string)).toEqual([{ fileId: "file-1", name: "Doc.docx", type: "docx" }]);
  });

  it("blocks propose_diff until signatures are checked, then records the summary", async () => {
    const file = fileState();
    const ctx = ctxOf(file);

    await expect(dispatchTool("propose_diff", { fileId: "file-1", summary: "правка" }, ctx)).rejects.toThrow(
      /check_document_signatures/,
    );
    expect(file.proposedSummary).toBeNull();

    const blocked = await dispatchTool(
      "check_document_signatures",
      { fileId: "file-1", hasSignatures: true, reasoning: "печать" },
      ctx,
    );
    expect(blocked).toMatch(/заблокированы/);
    await expect(dispatchTool("propose_diff", { fileId: "file-1", summary: "правка" }, ctx)).rejects.toThrow(
      /заблокировано/,
    );

    file.documentHasSignatures = undefined;
    const allowed = await dispatchTool(
      "check_document_signatures",
      { fileId: "file-1", hasSignatures: false, reasoning: "черновик" },
      ctx,
    );
    expect(allowed).toMatch(/Редактирование разрешено/);
    const prepared = await dispatchTool("propose_diff", { fileId: "file-1", summary: "заменил заголовок" }, ctx);
    expect(prepared).toMatch(/подготовлены/);
    expect(file.proposedSummary).toBe("заменил заголовок");
  });

  it("requires a known attached file id", async () => {
    const ctx = ctxOf(fileState());
    await expect(dispatchTool("propose_diff", { summary: "x" }, ctx)).rejects.toThrow(/Не указан fileId/);
    await expect(dispatchTool("propose_diff", { fileId: "missing", summary: "x" }, ctx)).rejects.toThrow(
      /не прикреплён/,
    );
    await expect(dispatchTool("not_a_tool", { fileId: "file-1" }, ctx)).rejects.toThrow(/Неизвестный инструмент/);
  });

  it("applies a docx replacement onto that file's buffer and changelog", async () => {
    const file = fileState();
    const edited = Buffer.from("edited");
    vi.mocked(docxTools.replaceDocxText).mockResolvedValue({ buffer: edited, occurrences: 2 });

    const message = await dispatchTool(
      "replace_text",
      { fileId: "file-1", find: "Hello", replace: "Hi" },
      ctxOf(file),
    );

    expect(message).toBe("Заменено вхождений: 2");
    expect(file.buffer).toBe(edited);
    expect(file.changeLog).toEqual(['Заменено "Hello" → "Hi" (2 вхождений)']);
  });
});

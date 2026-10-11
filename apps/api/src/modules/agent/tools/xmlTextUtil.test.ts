import { describe, expect, it } from "vitest";
import {
  decodeXmlEntities,
  encodeXmlEntities,
  extractPlainText,
  findBlockRanges,
  replaceTextAcrossRuns,
  setRunsText,
} from "./xmlTextUtil.js";

const SPLIT = `<w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t xml:space="preserve">world</w:t></w:r></w:p>`;

describe("xml entities", () => {
  it("round-trips quotes and ampersands without double-encoding", () => {
    const raw = `a & b <c> "d" 'e'`;
    expect(decodeXmlEntities(encodeXmlEntities(raw))).toBe(raw);
    expect(encodeXmlEntities(raw)).toBe("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;");
  });
});

describe("extractPlainText", () => {
  it("concatenates runs and can join them", () => {
    expect(extractPlainText(SPLIT, "w:t")).toBe("Hello world");
    expect(extractPlainText(SPLIT, "w:t", "|")).toBe("Hello |world");
    expect(extractPlainText("<w:p></w:p>", "w:t")).toBe("");
  });
});

describe("replaceTextAcrossRuns", () => {
  it("replaces a phrase split across runs and keeps the first run's formatting slot", () => {
    const result = replaceTextAcrossRuns(SPLIT, "w:t", "Hello world", "Hi & bye");
    expect(result.changed).toBe(true);
    expect(result.occurrences).toBe(1);
    expect(result.xml).toContain("<w:t>Hi &amp; bye</w:t>");
    expect(result.xml).toContain(`<w:t xml:space="preserve"></w:t>`);
    expect(extractPlainText(result.xml, "w:t")).toBe("Hi & bye");
  });

  it("counts every occurrence and leaves the document alone when nothing matches", () => {
    const xml = "<w:t>cat</w:t><w:t> cat</w:t>";
    const replaced = replaceTextAcrossRuns(xml, "w:t", "cat", "dog");
    expect(replaced.occurrences).toBe(2);
    expect(extractPlainText(replaced.xml, "w:t")).toBe("dog dog");

    expect(replaceTextAcrossRuns(SPLIT, "w:t", "missing", "x")).toEqual({
      xml: SPLIT,
      changed: false,
      occurrences: 0,
    });
    expect(replaceTextAcrossRuns(SPLIT, "w:t", "", "x")).toEqual({
      xml: SPLIT,
      changed: false,
      occurrences: 0,
    });
    expect(replaceTextAcrossRuns("<w:p></w:p>", "w:t", "a", "b")).toEqual({
      xml: "<w:p></w:p>",
      changed: false,
      occurrences: 0,
    });
  });
});

describe("setRunsText and findBlockRanges", () => {
  it("writes one string into the first run and blanks the rest", () => {
    expect(setRunsText("<a:t>Title</a:t><a:t>Body</a:t>", "a:t", "Q&A")).toBe("<a:t>Q&amp;A</a:t><a:t></a:t>");
    expect(setRunsText("<p/>", "a:t", "x")).toBe("<p/>");
  });

  it("returns paragraph ranges without crossing the next sibling", () => {
    const doc = `<w:p>a</w:p><w:p w:rsid="1">b</w:p>`;
    const blocks = findBlockRanges(doc, "w:p");
    expect(blocks).toHaveLength(2);
    expect(doc.slice(blocks[0].start, blocks[0].end)).toBe("<w:p>a</w:p>");
    expect(doc.slice(blocks[1].start, blocks[1].end)).toBe(`<w:p w:rsid="1">b</w:p>`);
  });
});

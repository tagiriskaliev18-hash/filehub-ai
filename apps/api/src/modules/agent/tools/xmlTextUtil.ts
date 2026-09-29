// Minimal, dependency-free helpers for reading/replacing text inside OOXML
// text-run tags (<w:t> in docx, <a:t> in pptx) directly in the raw XML string.
//
// Word/PowerPoint split a visually-contiguous sentence across multiple runs
// (spell-check boundaries, formatting changes), so a phrase you can see in the
// document often isn't a contiguous string in the XML. To handle that without
// a full OOXML object model, we concatenate all text-run contents in document
// order, do the find/replace on the concatenated string, and write the result
// back into the FIRST matched run — blanking the others. This means a replaced
// phrase adopts the formatting of its first run rather than preserving mixed
// per-run formatting mid-phrase, which is an acceptable MVP trade-off for a
// tool whose job is "change this text", not "repaginate this document".

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function encodeXmlEntities(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface TextSegment {
  matchStart: number;
  matchEnd: number;
  openTag: string;
  text: string;
}

function findTextSegments(xml: string, tagName: string): TextSegment[] {
  const re = new RegExp(`<${tagName}((?:\\s[^>]*)?)>([\\s\\S]*?)<\\/${tagName}>`, "g");
  const segments: TextSegment[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    segments.push({
      matchStart: m.index,
      matchEnd: m.index + m[0].length,
      openTag: `<${tagName}${m[1]}>`,
      text: decodeXmlEntities(m[2]),
    });
  }
  return segments;
}

export function extractPlainText(xml: string, tagName: string, joinWith = ""): string {
  return findTextSegments(xml, tagName)
    .map((s) => s.text)
    .join(joinWith);
}

export interface ReplaceResult {
  xml: string;
  changed: boolean;
  occurrences: number;
}

// Replaces every occurrence of `find` with `replace` across all text runs of
// the given tag, treating the document's runs as one continuous string.
export function replaceTextAcrossRuns(xml: string, tagName: string, find: string, replace: string): ReplaceResult {
  const segments = findTextSegments(xml, tagName);
  if (segments.length === 0) return { xml, changed: false, occurrences: 0 };

  const concatenated = segments.map((s) => s.text).join("");
  const occurrences = concatenated.split(find).length - 1;
  if (find.length === 0 || occurrences === 0) return { xml, changed: false, occurrences: 0 };

  const newConcatenated = concatenated.split(find).join(replace);

  // Splice the whole new text into the first run, blank the rest — done
  // back-to-front so earlier match indices stay valid as we edit the string.
  let out = xml;
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    const newInner = i === 0 ? encodeXmlEntities(newConcatenated) : "";
    const replacement = `${seg.openTag}${newInner}</${tagName}>`;
    out = out.slice(0, seg.matchStart) + replacement + out.slice(seg.matchEnd);
  }
  return { xml: out, changed: true, occurrences };
}

// Overwrites all text-run contents of a tag within a (typically scoped)
// XML fragment with a single new string — used for shape-level placeholder
// text replacement (pptx title/body) rather than find/replace.
export function setRunsText(xmlFragment: string, tagName: string, newText: string): string {
  const segments = findTextSegments(xmlFragment, tagName);
  if (segments.length === 0) return xmlFragment;
  let out = xmlFragment;
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    const newInner = i === 0 ? encodeXmlEntities(newText) : "";
    const replacement = `${seg.openTag}${newInner}</${tagName}>`;
    out = out.slice(0, seg.matchStart) + replacement + out.slice(seg.matchEnd);
  }
  return out;
}

// Finds the byte ranges of a block-level tag (e.g. <w:p> paragraphs, <a:p>
// paragraphs) so callers can scope a text operation to "one paragraph" rather
// than "the whole document" — see docx.ts/pptx.ts for why that scoping matters.
export function findBlockRanges(xml: string, tagName: string): { start: number; end: number }[] {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tagName}>`, "g");
  const blocks: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) blocks.push({ start: m.index, end: m.index + m[0].length });
  return blocks;
}

export { encodeXmlEntities, decodeXmlEntities };

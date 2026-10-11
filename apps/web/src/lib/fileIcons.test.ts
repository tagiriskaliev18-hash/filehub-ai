import { describe, expect, it } from "vitest";
import { iconFor } from "./fileIcons";

describe("iconFor", () => {
  it("maps Office, PDF, zip, and media prefixes, and falls back to a generic file", () => {
    expect(iconFor("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("template");
    expect(iconFor("application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe("chart");
    expect(iconFor("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("table");
    expect(iconFor("application/pdf")).toBe("file-pdf");
    expect(iconFor("application/zip")).toBe("archive");
    expect(iconFor("image/png")).toBe("image");
    expect(iconFor("video/mp4")).toBe("film");
    expect(iconFor("audio/mpeg")).toBe("music");
    expect(iconFor("text/plain")).toBe("file");
  });
});

import type { Job } from "@prisma/client";
import type { AgentMessage } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { toAgentMessageDto } from "../agent/dto.js";
import { toJobDto } from "./dto.js";

describe("toJobDto", () => {
  it("copies status fields and leaves a running job without a result", () => {
    expect(
      toJobDto({
        id: "job-1",
        type: "compress",
        status: "running",
        progress: 40,
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        resultJson: null,
        errorMessage: null,
      } as Job),
    ).toEqual({
      id: "job-1",
      type: "compress",
      status: "running",
      progress: 40,
      createdAt: "2026-04-01T00:00:00.000Z",
      resultJson: null,
      errorMessage: null,
    });
  });
});

describe("toAgentMessageDto", () => {
  const base = {
    id: "msg-1",
    sessionId: "session-1",
    role: "assistant",
    content: "готово",
    status: "pending",
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
  };

  it("maps the stored targetName field onto targetFileName", () => {
    const dto = toAgentMessageDto({
      ...base,
      proposedDiff: JSON.stringify({
        summary: "заголовок",
        before: "old",
        after: "new",
        targetFileId: "file-1",
        targetName: "Doc.docx",
        draftKey: "drafts/secret",
      }),
    } as AgentMessage);
    expect(dto.proposedDiff).toEqual({
      summary: "заголовок",
      before: "old",
      after: "new",
      targetFileId: "file-1",
      targetFileName: "Doc.docx",
    });
    expect(dto.createdAt).toBe("2026-04-01T00:00:00.000Z");
  });

  it("leaves proposedDiff null and throws on malformed JSON", () => {
    expect(toAgentMessageDto({ ...base, proposedDiff: null } as AgentMessage).proposedDiff).toBeNull();
    expect(() => toAgentMessageDto({ ...base, proposedDiff: "not-json" } as AgentMessage)).toThrow();
  });
});

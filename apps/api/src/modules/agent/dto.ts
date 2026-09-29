import type { AgentMessage } from "@prisma/client";
import type { AgentMessageDto, AgentMessageStatus } from "@filehub/shared";

export function toAgentMessageDto(message: AgentMessage): AgentMessageDto {
  let proposedDiff: AgentMessageDto["proposedDiff"] = null;
  if (message.proposedDiff) {
    const full = JSON.parse(message.proposedDiff);
    proposedDiff = {
      summary: full.summary,
      before: full.before,
      after: full.after,
      targetFileId: full.targetFileId,
      targetFileName: full.targetName,
    };
  }
  return {
    id: message.id,
    sessionId: message.sessionId,
    role: message.role as "user" | "assistant",
    content: message.content,
    proposedDiff,
    status: message.status as AgentMessageStatus,
    createdAt: message.createdAt.toISOString(),
  };
}

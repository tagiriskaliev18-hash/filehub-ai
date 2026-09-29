import type {
  AgentMessageDto,
  AuditLogDto,
  FileDto,
  FileVersionDto,
  FolderDto,
  JobDto,
  UserDto,
} from "@filehub/shared";

// Talk to the API on whatever host the page itself was loaded from, rather
// than a hardcoded address. The session cookie is SameSite=Lax, so if the
// page were served from one host (e.g. a hostname link) while API calls went
// to a different one (e.g. a hardcoded IP), the browser treats that as
// cross-site and silently drops the cookie on every request except the
// login response itself — the exact bug that made the UI show a logged-in
// user (from the login response body) while every other API call 401'd.
// VITE_API_URL remains as an explicit override for setups where the API
const API_URL =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:4000` : "");

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error ?? message;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function json(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

export const api = {
  // --- auth ---
  register: (email: string, password: string) => request<UserDto>("/api/auth/register", json({ email, password })),
  login: (email: string, password: string) => request<UserDto>("/api/auth/login", json({ email, password })),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  me: () => request<UserDto>("/api/auth/me"),

  // --- files ---
  listFolder: (folderId: string | null) =>
    request<{ folders: FolderDto[]; files: FileDto[] }>(`/api/files${folderId ? `?folderId=${folderId}` : ""}`),
  listTrash: () => request<{ files: FileDto[] }>("/api/files/trash"),
  listAllFiles: () => request<{ files: FileDto[] }>("/api/files/all"),
  search: (q: string) => request<{ files: FileDto[] }>(`/api/files/search?q=${encodeURIComponent(q)}`),
  createFolder: (name: string, parentId: string | null) =>
    request<FolderDto>("/api/files/folders", json({ name, parentId })),
  renameFolder: (id: string, name: string) =>
    request<FolderDto>(`/api/files/folders/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteFolder: (id: string) => request<void>(`/api/files/folders/${id}`, { method: "DELETE" }),
  upload: (files: File[], folderId: string | null) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    if (folderId) form.append("folderId", folderId);
    return request<{ files: FileDto[] }>("/api/files/upload", { method: "POST", body: form });
  },
  renameFile: (id: string, name: string) =>
    request<FileDto>(`/api/files/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  moveFile: (id: string, folderId: string | null) =>
    request<FileDto>(`/api/files/${id}`, { method: "PATCH", body: JSON.stringify({ folderId }) }),
  trashFile: (id: string) => request<void>(`/api/files/${id}`, { method: "DELETE" }),
  deleteFileForever: (id: string) => request<void>(`/api/files/${id}?hard=true`, { method: "DELETE" }),
  restoreFile: (id: string) => request<FileDto>(`/api/files/${id}/restore`, { method: "POST" }),
  emptyTrash: () => request<{ deletedCount: number }>("/api/files/trash", { method: "DELETE" }),
  fileVersions: (id: string) => request<{ versions: FileVersionDto[] }>(`/api/files/${id}/versions`),
  restoreVersion: (id: string, versionId: string) =>
    request<FileDto>(`/api/files/${id}/versions/${versionId}/restore`, { method: "POST" }),
  undoLastChange: (id: string) => request<FileDto>(`/api/files/${id}/undo`, { method: "POST" }),
  downloadUrl: (id: string) => `${API_URL}/api/files/${id}/download`,
  previewUrl: (id: string) => `${API_URL}/api/files/${id}/preview`,
  createShare: (id: string, body: { allowAnyInOrg: boolean; userIds?: string[]; expiresInDays?: number }) =>
    request<{ token: string }>(`/api/files/${id}/shares`, json(body)),
  listShares: (id: string) => request<{ shares: { id: string; token: string; createdAt: string }[] }>(`/api/files/${id}/shares`),
  revokeShare: (id: string, shareId: string) => request<void>(`/api/files/${id}/shares/${shareId}`, { method: "DELETE" }),

  // --- jobs ---
  listJobs: () => request<{ jobs: JobDto[] }>("/api/jobs"),
  getJob: (id: string) => request<JobDto>(`/api/jobs/${id}`),

  // --- compression / conversion ---
  compress: (fileIds: string[], targetValue: number, targetUnit: "MB" | "KB" | "PERCENT", asNewFile: boolean) =>
    request<JobDto>("/api/compress", json({ fileIds, targetValue, targetUnit, asNewFile })),
  convert: (fileIds: string[], targetFormat: string) => request<JobDto>("/api/convert", json({ fileIds, targetFormat })),
  conversionMatrix: () => request<{ matrix: Record<string, string[]>; libreOfficeAvailable: boolean }>("/api/convert/matrix"),

  // --- agent ---
  agentStatus: () => request<{ aiEnabled: boolean }>("/api/agent/status"),
  getOrCreateSession: (fileId: string) =>
    request<{ sessionId: string }>(`/api/agent/sessions/by-file/${fileId}`, { method: "POST" }),
  createGeneralAgentSession: () => request<{ sessionId: string }>("/api/agent/sessions", { method: "POST" }),
  listSessionFiles: (sessionId: string) => request<{ files: FileDto[] }>(`/api/agent/sessions/${sessionId}/files`),
  attachFileToSession: (sessionId: string, fileId: string) =>
    request<FileDto>(`/api/agent/sessions/${sessionId}/files`, json({ fileId })),
  uploadFileToSession: (sessionId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<FileDto>(`/api/agent/sessions/${sessionId}/upload`, { method: "POST", body: form });
  },
  detachFileFromSession: (sessionId: string, fileId: string) =>
    request<void>(`/api/agent/sessions/${sessionId}/files/${fileId}`, { method: "DELETE" }),
  listAgentMessages: (sessionId: string) =>
    request<{ messages: AgentMessageDto[] }>(`/api/agent/sessions/${sessionId}/messages`),
  // Server-side status independent of any open connection — lets the UI
  // recover "still working" after navigating away mid-reply and back (the
  // tool-use loop keeps running regardless of who's watching).
  getAgentProgress: (sessionId: string) =>
    request<{ status: "idle" | "running" | "error"; steps: string[]; error?: string }>(`/api/agent/sessions/${sessionId}/progress`),
  // Streams NDJSON progress events while the agent's tool-use loop runs
  // ({type:"status", text}) and resolves with the final message once a
  // {type:"done"} event arrives — lets the UI show live "what it's doing"
  // steps instead of a blind wait, per the ТЗ's "show progress of long
  // operations" requirement (§4.5) applied to the agent specifically.
  streamAgentMessage: async (sessionId: string, content: string, onStatus: (text: string) => void): Promise<AgentMessageDto> => {
    const res = await fetch(`${API_URL}/api/agent/sessions/${sessionId}/messages`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok || !res.body) {
      let message = res.statusText;
      try {
        message = (await res.json()).error ?? message;
      } catch {
        // ignore non-JSON error bodies
      }
      throw new ApiError(res.status, message);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: AgentMessageDto | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "status") onStatus(event.text);
        else if (event.type === "done") result = event.message;
        else if (event.type === "error") throw new ApiError(500, event.message);
      }
    }

    if (!result) throw new ApiError(500, "ИИ-агент не вернул ответ");
    return result;
  },
  applyAgentMessage: (messageId: string) => request<FileDto>(`/api/agent/messages/${messageId}/apply`, { method: "POST" }),
  rejectAgentMessage: (messageId: string) => request<void>(`/api/agent/messages/${messageId}/reject`, { method: "POST" }),

  // --- admin ---
  adminUsers: () => request<{ users: UserDto[] }>("/api/admin/users"),
  adminUpdateUser: (id: string, patch: Partial<{ role: string; storageQuotaBytes: number; aiRequestQuota: number; isBlocked: boolean }>) =>
    request<UserDto>(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  adminAuditLog: () => request<{ entries: AuditLogDto[] }>("/api/admin/audit-log"),
  adminStats: () =>
    request<{ userCount: number; fileCount: number; totalStorageBytes: number; jobCounts: { type: string; status: string; count: number }[] }>(
      "/api/admin/stats",
    ),
  adminConversionSettings: () =>
    request<{ fullMatrix: Record<string, string[]>; disabled: string[] }>("/api/admin/conversion-settings"),
  adminSetConversionSettings: (disabled: string[]) =>
    request<void>("/api/admin/conversion-settings", { method: "PUT", body: JSON.stringify({ disabled }) }),
};

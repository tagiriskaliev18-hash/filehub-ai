// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Bad Request",
    json: async () => body,
  } as Response;
}

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts JSON with the session cookie and reads error bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "user-1", email: "a@example.com" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.login("a@example.com", "correct horse battery");
    const loginUrl = String(fetchMock.mock.calls[0][0]);
    const loginInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(loginUrl).toMatch(/\/api\/auth\/login$/);
    expect(loginInit.method).toBe("POST");
    expect(loginInit.credentials).toBe("include");
    expect(loginInit.body).toBe(JSON.stringify({ email: "a@example.com", password: "correct horse battery" }));
    expect(loginInit.headers).toMatchObject({ "Content-Type": "application/json" });

    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({ error: "Требуется вход в систему" }),
    });
    await expect(api.me()).rejects.toMatchObject({
      status: 401,
      message: "Требуется вход в систему",
    });
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);

    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => {
        throw new Error("not json");
      },
    });
    await expect(api.me()).rejects.toMatchObject({ status: 502, message: "Bad Gateway" });
  });

  it("treats 204 as an empty success and does not force a JSON content type on uploads", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: "No Content",
      json: async () => {
        throw new Error("no body");
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.logout()).resolves.toBeUndefined();

    fetchMock.mockResolvedValue(jsonResponse({ files: [] }));
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    await api.upload([file], "folder-1");
    const uploadInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(uploadInit.method).toBe("POST");
    expect(uploadInit.body).toBeInstanceOf(FormData);
    expect((uploadInit.body as FormData).get("folderId")).toBe("folder-1");
    expect(uploadInit.headers).not.toHaveProperty("Content-Type");

    await api.upload([file], null);
    const rootInit = fetchMock.mock.calls[2][1] as RequestInit;
    expect((rootInit.body as FormData).get("folderId")).toBeNull();
  });

  it("encodes search text and omits folderId when listing the root", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ files: [], folders: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await api.search("a b/ц");
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/api/files/search?q=${encodeURIComponent("a b/ц")}`);

    await api.listFolder(null);
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/api\/files$/);
    await api.listFolder("folder-1");
    expect(String(fetchMock.mock.calls[2][0])).toContain("/api/files?folderId=folder-1");

    expect(api.downloadUrl("file-1")).toMatch(/\/api\/files\/file-1\/download$/);
    expect(api.previewUrl("file-1")).toMatch(/\/api\/files\/file-1\/preview$/);
  });
});

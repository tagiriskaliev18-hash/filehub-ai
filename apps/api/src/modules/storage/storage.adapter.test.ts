import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../env.js";
import { newStorageKey, storage } from "./storage.adapter.js";

describe("local disk storage", () => {
  let root = "";
  let previous = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "filehub-storage-"));
    previous = env.storageRoot;
    env.storageRoot = root;
  });

  afterEach(() => {
    env.storageRoot = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("builds owner/file/version keys and round-trips bytes", async () => {
    expect(newStorageKey("user-1", "file-1", "v2")).toBe("user-1/file-1/v2");
    const key = newStorageKey("user-1", "file-1", "v1");
    await storage.put(key, Buffer.from("hello"));
    expect(await storage.exists(key)).toBe(true);
    expect(await storage.get(key)).toEqual(Buffer.from("hello"));
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    const written = path.join(root, "user-1", "file-1", "v1");
    expect(fs.existsSync(written)).toBe(false);
  });

  it("refuses keys that would leave the storage root", async () => {
    await expect(storage.put("../outside.txt", Buffer.from("no"))).rejects.toThrow(/Invalid storage key/);
    await expect(storage.put("/etc/passwd", Buffer.from("no"))).rejects.toThrow(/Invalid storage key/);
    await expect(storage.put("user/../../outside.txt", Buffer.from("no"))).rejects.toThrow(/Invalid storage key/);
    expect(fs.existsSync(path.join(path.dirname(root), "outside.txt"))).toBe(false);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("still stores a normal draft key", async () => {
    await storage.put("drafts/session-1", Buffer.from("draft"));
    expect(fs.readFileSync(path.join(root, "drafts", "session-1"), "utf8")).toBe("draft");
  });
});

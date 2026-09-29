import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { env } from "../../env.js";

// S3-shaped interface over local disk. Swap the implementation for a real
// S3/MinIO client later (put/get/delete/list signatures stay the same) —
// nothing outside this file needs to change.
export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  getStream(key: string): NodeJS.ReadableStream;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

class LocalDiskStorage implements StorageAdapter {
  private resolve(key: string): string {
    const safeKey = key.replace(/\.\./g, "");
    return path.join(env.storageRoot, safeKey);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  getStream(key: string): NodeJS.ReadableStream {
    return createReadStream(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

export const storage: StorageAdapter = new LocalDiskStorage();

export function newStorageKey(ownerId: string, fileId: string, versionSuffix: string): string {
  return `${ownerId}/${fileId}/${versionSuffix}`;
}

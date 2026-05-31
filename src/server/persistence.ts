import { mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { blobPathPrefix, isBlobPersistenceEnabled } from "./runtime.js";

export interface TextStore {
  readonly description: string;
  readText(): Promise<string | undefined>;
  writeText(value: string): Promise<void>;
}

export class FileTextStore implements TextStore {
  readonly description: string;

  constructor(readonly filePath: string, private readonly mode = 0o600) {
    this.description = filePath;
  }

  async readText(): Promise<string | undefined> {
    try {
      return await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
  }

  async writeText(value: string): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, value, { encoding: "utf8", mode: this.mode });
    await chmod(tempPath, this.mode).catch(() => undefined);
    await rename(tempPath, this.filePath);
    await chmod(this.filePath, this.mode).catch(() => undefined);
  }
}

export class BlobTextStore implements TextStore {
  readonly description: string;

  constructor(readonly pathname: string) {
    this.description = `vercel-blob:${pathname}`;
  }

  async readText(): Promise<string | undefined> {
    const { BlobNotFoundError, get } = await import("@vercel/blob");
    try {
      const result = await get(this.pathname, { access: "private", useCache: false });
      if (!result || result.statusCode !== 200) return undefined;
      return await readableStreamToString(result.stream);
    } catch (error) {
      if (error instanceof BlobNotFoundError) return undefined;
      throw error;
    }
  }

  async writeText(value: string): Promise<void> {
    const { put } = await import("@vercel/blob");
    await put(this.pathname, value, {
      access: "private",
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60
    });
  }
}

export interface RunPersistence {
  readonly enabled: boolean;
  readSnapshot(): Promise<string | undefined>;
  writeSnapshot(value: string): Promise<void>;
  writeScreenshot(runId: string, screenshotId: string, dataUri: string): Promise<string>;
  readScreenshot(runId: string, screenshotId: string): Promise<string | undefined>;
}

export class BlobRunPersistence implements RunPersistence {
  readonly enabled = true;
  private readonly snapshotStore: BlobTextStore;

  constructor(private readonly prefix = blobPathPrefix()) {
    this.snapshotStore = new BlobTextStore(`${prefix}/runs/snapshot.json`);
  }

  readSnapshot(): Promise<string | undefined> {
    return this.snapshotStore.readText();
  }

  writeSnapshot(value: string): Promise<void> {
    return this.snapshotStore.writeText(value);
  }

  async writeScreenshot(runId: string, screenshotId: string, dataUri: string): Promise<string> {
    const { put } = await import("@vercel/blob");
    const pathname = this.screenshotPath(runId, screenshotId);
    await put(pathname, dataUri, {
      access: "private",
      allowOverwrite: true,
      contentType: "text/plain",
      cacheControlMaxAge: 60
    });
    return pathname;
  }

  async readScreenshot(runId: string, screenshotId: string): Promise<string | undefined> {
    return new BlobTextStore(this.screenshotPath(runId, screenshotId)).readText();
  }

  private screenshotPath(runId: string, screenshotId: string): string {
    return `${this.prefix}/runs/${safePathPart(runId)}/screenshots/${safePathPart(screenshotId)}.txt`;
  }
}

export function projectTextStore(defaultPath: string): TextStore {
  return isBlobPersistenceEnabled() ? new BlobTextStore(`${blobPathPrefix()}/data/projects.json`) : new FileTextStore(defaultPath, 0o600);
}

export function secretTextStore(defaultPath: string): TextStore {
  return isBlobPersistenceEnabled() ? new BlobTextStore(`${blobPathPrefix()}/data/secrets.json`) : new FileTextStore(defaultPath, 0o600);
}

export function runPersistence(): RunPersistence | undefined {
  return isBlobPersistenceEnabled() ? new BlobRunPersistence() : undefined;
}

export function dataUriToResponse(dataUri: string): { buffer: Buffer; contentType: string } | undefined {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUri.trim());
  if (!match) return undefined;
  return { contentType: match[1], buffer: Buffer.from(match[2], "base64") };
}

async function readableStreamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Readable.fromWeb(stream as unknown as import("node:stream/web").ReadableStream<Uint8Array>)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}

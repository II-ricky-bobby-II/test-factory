import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { secretTextStore, type TextStore } from "./persistence.js";
import { isBlobPersistenceEnabled, isVercelRuntime } from "./runtime.js";

const SECRET_STORE_VERSION = 1;
const KEY_LENGTH = 32;

const persistedSecretSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  iv: z.string(),
  tag: z.string(),
  ciphertext: z.string()
});

const persistedSecretDataSchema = z.object({
  version: z.literal(SECRET_STORE_VERSION),
  secrets: z.array(persistedSecretSchema)
});

type PersistedSecretData = z.infer<typeof persistedSecretDataSchema>;
type PersistedSecret = z.infer<typeof persistedSecretSchema>;

export class SecretStore {
  private writeQueue: Promise<unknown> = Promise.resolve();
  private readonly store: TextStore;

  constructor(
    filePathOrStore: string | TextStore = resolveSecretStorePath(),
    private readonly keyPath = resolveSecretKeyPath()
  ) {
    this.store = typeof filePathOrStore === "string" ? secretTextStore(filePathOrStore) : filePathOrStore;
  }

  async setSecret(value: string, existingId?: string): Promise<string> {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error("Secret value cannot be empty.");
    }
    const key = await this.encryptionKey();
    return this.mutate((data) => {
      const now = new Date().toISOString();
      const encrypted = encrypt(trimmed, key);
      const secret = data.secrets.find((candidate) => candidate.id === existingId);
      if (secret) {
        Object.assign(secret, encrypted, { updatedAt: now });
        return secret.id;
      }
      const next: PersistedSecret = {
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        ...encrypted
      };
      data.secrets.push(next);
      return next.id;
    });
  }

  async getSecret(id?: string): Promise<string | undefined> {
    if (!id) return undefined;
    const data = await this.read();
    const secret = data.secrets.find((candidate) => candidate.id === id);
    if (!secret) return undefined;
    return decrypt(secret, await this.encryptionKey());
  }

  async deleteSecret(id?: string): Promise<void> {
    if (!id) return;
    await this.mutate((data) => {
      data.secrets = data.secrets.filter((secret) => secret.id !== id);
    });
  }

  private async mutate<T>(operation: (data: PersistedSecretData) => T): Promise<T> {
    const next = this.writeQueue.then(async () => {
      const data = await this.read();
      const result = operation(data);
      await this.write(data);
      return result;
    });
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<PersistedSecretData> {
    const raw = await this.store.readText();
    if (!raw) return { version: SECRET_STORE_VERSION, secrets: [] };

    const parsed = persistedSecretDataSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`Invalid Test Factory secret store at ${this.store.description}: ${parsed.error.message}`);
    }
    return {
      version: SECRET_STORE_VERSION,
      secrets: parsed.data.secrets.map((secret) => ({ ...secret }))
    };
  }

  private async write(data: PersistedSecretData): Promise<void> {
    await this.store.writeText(`${JSON.stringify(data, null, 2)}\n`);
  }

  private async encryptionKey(): Promise<Buffer> {
    if (process.env.QA_SMOKE_SECRET_KEY) {
      return createHash("sha256").update(process.env.QA_SMOKE_SECRET_KEY).digest();
    }

    if (isVercelRuntime() || isBlobPersistenceEnabled()) {
      throw new Error("QA_SMOKE_SECRET_KEY is required when Test Factory stores secrets outside the local filesystem.");
    }

    try {
      const raw = await readFile(this.keyPath, "utf8");
      const key = Buffer.from(raw.trim(), "base64");
      if (key.length === KEY_LENGTH) return key;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }

    const key = randomBytes(KEY_LENGTH);
    await mkdir(path.dirname(this.keyPath), { recursive: true });
    await writeFile(this.keyPath, `${key.toString("base64")}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(this.keyPath, 0o600).catch(() => undefined);
    return key;
  }
}

export function resolveSecretStorePath(): string {
  return path.resolve(process.cwd(), ".qa-smoke/secrets.json");
}

export function resolveSecretKeyPath(): string {
  return path.resolve(process.cwd(), ".qa-smoke/secrets.key");
}

function encrypt(value: string, key: Buffer): Pick<PersistedSecret, "iv" | "tag" | "ciphertext"> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function decrypt(secret: Pick<PersistedSecret, "iv" | "tag" | "ciphertext">, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type express from "express";
import { isProductionRuntime } from "./runtime.js";

const COOKIE_NAME = "test_factory_session";
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const PASSWORD_HASH_PREFIX = "scrypt";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

export interface AuthStatus {
  authEnabled: boolean;
  configured: boolean;
  authenticated: boolean;
  expiresAt?: string;
}

export class AuthService {
  constructor(
    private readonly passwordHash = process.env.TEST_FACTORY_ADMIN_PASSWORD_HASH || "",
    private readonly sessionSecret = process.env.TEST_FACTORY_SESSION_SECRET || ""
  ) {}

  status(request?: express.Request): AuthStatus {
    if (!this.isEnabled()) {
      return { authEnabled: false, configured: true, authenticated: true };
    }
    if (!this.isConfigured()) {
      return { authEnabled: true, configured: false, authenticated: false };
    }
    const session = request ? this.verifySessionFromRequest(request) : undefined;
    return {
      authEnabled: true,
      configured: true,
      authenticated: Boolean(session),
      expiresAt: session ? new Date(session.exp).toISOString() : undefined
    };
  }

  isEnabled(): boolean {
    return isProductionRuntime() || Boolean(this.passwordHash || this.sessionSecret);
  }

  isConfigured(): boolean {
    return Boolean(this.passwordHash && this.sessionSecret);
  }

  verifyPassword(password: string): boolean {
    if (!this.isConfigured()) return false;
    return verifyPasswordHash(password, this.passwordHash);
  }

  issueCookie(request: express.Request): string {
    const exp = Date.now() + SESSION_TTL_SECONDS * 1000;
    const payload = base64UrlEncode(JSON.stringify({ sub: "owner", exp }));
    const signature = sign(payload, this.sessionSecret);
    return serializeCookie(COOKIE_NAME, `${payload}.${signature}`, {
      maxAge: SESSION_TTL_SECONDS,
      secure: shouldUseSecureCookie(request)
    });
  }

  clearCookie(request: express.Request): string {
    return serializeCookie(COOKIE_NAME, "", { maxAge: 0, secure: shouldUseSecureCookie(request) });
  }

  requireAuth(): express.RequestHandler {
    return (request, response, next) => {
      if (!request.path.startsWith("/api")) {
        next();
        return;
      }
      if (isPublicApiPath(request.path)) {
        next();
        return;
      }
      if (!this.isEnabled()) {
        next();
        return;
      }
      if (!this.isConfigured()) {
        response.status(503).json({ error: "Test Factory owner login is not configured." });
        return;
      }
      if (!this.verifySessionFromRequest(request)) {
        response.status(401).json({ error: "Owner login required." });
        return;
      }
      if (!isSafeMethod(request.method) && request.headers["x-test-factory-csrf"] !== "1") {
        response.status(403).json({ error: "Missing CSRF confirmation header." });
        return;
      }
      next();
    };
  }

  private verifySessionFromRequest(request: express.Request): { exp: number } | undefined {
    const token = parseCookie(request.headers.cookie || "")[COOKIE_NAME];
    if (!token) return undefined;
    const [payload, signature] = token.split(".");
    if (!payload || !signature || !safeEqual(signature, sign(payload, this.sessionSecret))) return undefined;
    try {
      const parsed = JSON.parse(base64UrlDecode(payload)) as { sub?: string; exp?: number };
      if (parsed.sub !== "owner" || typeof parsed.exp !== "number" || parsed.exp < Date.now()) return undefined;
      return { exp: parsed.exp };
    } catch {
      return undefined;
    }
  }
}

export function hashPassword(password: string, salt = randomBytes(16)): string {
  if (!password) throw new Error("Password cannot be empty.");
  const derived = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return [PASSWORD_HASH_PREFIX, SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

export function verifyPasswordHash(password: string, encoded: string): boolean {
  const [prefix, rawN, rawR, rawP, salt, hash] = encoded.split("$");
  if (prefix !== PASSWORD_HASH_PREFIX || !rawN || !rawR || !rawP || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(rawN),
    r: Number(rawR),
    p: Number(rawP)
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function isPublicApiPath(pathname: string): boolean {
  return (
    pathname === "/api/health" ||
    pathname === "/api/auth/session" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/github/webhook" ||
    pathname === "/api/github/setup" ||
    pathname === "/api/github/manifest/callback"
  );
}

function isSafeMethod(method: string): boolean {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function serializeCookie(name: string, value: string, options: { maxAge: number; secure: boolean }): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${Math.floor(options.maxAge)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    options.secure ? "Secure" : ""
  ]
    .filter(Boolean)
    .join("; ");
}

function shouldUseSecureCookie(request: express.Request): boolean {
  return isProductionRuntime() || request.secure || request.headers["x-forwarded-proto"] === "https";
}

function parseCookie(header: string): Record<string, string> {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator < 0) return [part, ""];
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      })
  );
}

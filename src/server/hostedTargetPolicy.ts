import dns from "node:dns/promises";
import net from "node:net";
import { isHostedTargetProtectionEnabled } from "./runtime.js";

const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal"];
const METADATA_HOSTS = new Set(["metadata.google.internal"]);

export async function assertAllowedHostedTarget(url: string): Promise<void> {
  const reason = await hostedTargetBlockReason(url);
  if (reason) throw new Error(reason);
}

export async function hostedTargetBlockReason(url: string): Promise<string | undefined> {
  if (!isHostedTargetProtectionEnabled()) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Deployment URL is invalid.";
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Hosted runs only allow http and https deployment URLs.";
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(hostname) || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) || METADATA_HOSTS.has(hostname)) {
    return "Hosted runs cannot target localhost, private, internal, or metadata hostnames.";
  }

  const literalBlock = blockedAddressReason(hostname);
  if (literalBlock) return literalBlock;

  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    const blocked = addresses.map((address) => blockedAddressReason(address.address)).find(Boolean);
    if (blocked) return blocked;
  } catch {
    return "Could not resolve deployment URL hostname for hosted-run safety checks.";
  }

  return undefined;
}

function blockedAddressReason(address: string): string | undefined {
  const version = net.isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10) return blockedAddressMessage();
    if (a === 127) return blockedAddressMessage();
    if (a === 0) return blockedAddressMessage();
    if (a === 169 && b === 254) return blockedAddressMessage();
    if (a === 172 && b >= 16 && b <= 31) return blockedAddressMessage();
    if (a === 192 && b === 168) return blockedAddressMessage();
    if (a === 100 && b >= 64 && b <= 127) return blockedAddressMessage();
    if (a === 198 && (b === 18 || b === 19)) return blockedAddressMessage();
    if (a >= 224) return blockedAddressMessage();
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) {
      return blockedAddressMessage();
    }
  }
  return undefined;
}

function blockedAddressMessage(): string {
  return "Hosted runs cannot target localhost, private, internal, or metadata network addresses.";
}

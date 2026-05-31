export function isVercelRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.NOW_REGION || process.env.VERCEL_ENV);
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || isVercelRuntime();
}

export function isHostedTargetProtectionEnabled(): boolean {
  return process.env.TEST_FACTORY_ENFORCE_HOSTED_TARGETS === "true" || isVercelRuntime();
}

export function isBlobPersistenceEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN && (isVercelRuntime() || process.env.TEST_FACTORY_STORAGE === "blob"));
}

export function blobPathPrefix(): string {
  return (process.env.TEST_FACTORY_BLOB_PREFIX || "test-factory").replace(/^\/+|\/+$/g, "") || "test-factory";
}

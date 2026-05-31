import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  ".qa-smoke",
  ".vercel",
  "coverage",
  "dist",
  "dist-server",
  "node_modules",
  "output",
  "playwright-report",
  "test-results"
]);
const ignoredFileNames = new Set([".env", ".DS_Store", "package-lock.json"]);
const ignoredExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".br"]);
const secretPatterns = [
  { name: "Anthropic API key", pattern: /sk-ant-api[0-9a-zA-Z_-]{20,}/ },
  { name: "GitHub token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[0-9A-Za-z_]{20,}/ },
  { name: "Private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "Vercel token", pattern: /\bvercel_[0-9A-Za-z]{20,}/ },
  { name: "Blob token assignment", pattern: /\bBLOB_READ_WRITE_TOKEN\s*=\s*[^#\s]+/ }
];

const findings = [];

for await (const filePath of walk(root)) {
  const relative = path.relative(root, filePath);
  if (isIgnoredFile(relative)) continue;
  const raw = await readFile(filePath);
  if (raw.includes(0)) continue;
  const text = raw.toString("utf8");
  for (const { name, pattern } of secretPatterns) {
    if (pattern.test(text)) {
      findings.push(`${relative}: matched ${name}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Release audit failed. Potential secret material was found:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("Release audit passed: no known secret patterns found in publishable files.");

async function* walk(directory) {
  for (const entry of await readdir(directory)) {
    const fullPath = path.join(directory, entry);
    const relative = path.relative(root, fullPath);
    const stat = await lstat(fullPath);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (!ignoredDirectories.has(entry)) yield* walk(fullPath);
      continue;
    }
    if (stat.isFile()) yield fullPath;
  }
}

function isIgnoredFile(relativePath) {
  const baseName = path.basename(relativePath);
  if (ignoredFileNames.has(baseName)) return true;
  if (baseName.startsWith(".env.")) return true;
  return ignoredExtensions.has(path.extname(baseName).toLowerCase());
}

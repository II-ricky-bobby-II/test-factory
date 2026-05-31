import { randomBytes, scryptSync } from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

const password = process.argv[2];

if (!password) {
  console.error("Usage: npm run hash:admin-password -- <password>");
  process.exit(1);
}

const salt = randomBytes(16);
const derived = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
console.log(["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64url"), derived.toString("base64url")].join("$"));

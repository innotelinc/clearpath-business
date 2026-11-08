import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/** URL-safe random token, hex encoded. */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

export function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

/** Constant-time string comparison that tolerates length differences. */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  if (left.length !== right.length) {
    // Compare something of equal length so timing does not leak the length.
    const filler = Buffer.alloc(left.length || 1);
    timingSafeEqual(left.length ? left : filler, left.length ? left : filler);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function hashPassword(password) {
  const salt = randomToken(16);
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}

export function verifyPassword(password, salt, expected) {
  if (!salt || !expected) return false;
  const actual = scryptSync(String(password ?? ""), salt, 64).toString("hex");
  return safeEqual(actual, expected);
}

/** HMAC-SHA256 hex signature, used for the Denovo lead handoff. */
export function hmacHex(secret, raw) {
  return createHmac("sha256", String(secret)).update(raw).digest("hex");
}

export function verifyHmac(secret, raw, header) {
  if (!secret || !header) return false;
  return safeEqual(hmacHex(secret, raw), String(header).trim().toLowerCase());
}

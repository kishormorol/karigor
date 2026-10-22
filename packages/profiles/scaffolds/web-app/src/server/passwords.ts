import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEY_BYTES = 64;

export const MIN_PASSWORD_LENGTH = 8;

function scrypt(password: string, salt: Buffer, keyLength: number, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keyLength, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** `scrypt$N$r$p$salt$hash`, salt and hash in base64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_BYTES, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0)) return false;
  const expected = Buffer.from(parts[5]!, "base64");
  if (expected.length === 0) return false;
  try {
    const actual = await scrypt(password, Buffer.from(parts[4]!, "base64"), expected.length, n, r, p);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Checked when the email is unknown, so a wrong email takes as long as a wrong password. */
let dummy: Promise<string> | undefined;
export const dummyHash = () => (dummy ??= hashPassword("not-a-real-password"));

/** A random value for a cookie or a link; only its hash is stored. */
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Plain-words problem with a new password, or undefined when it is fine. */
export function passwordProblem(password: string, again: string): string | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== again) return "The two passwords are not the same.";
  return undefined;
}

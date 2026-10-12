/**
 * Primitives de sécurité, toutes bâties sur node:crypto (aucune dépendance) :
 * mots de passe (scrypt), jetons d'accès (JWT HS256), double authentification
 * (TOTP, RFC 6238), chiffrement des secrets (AES-256-GCM), jetons aléatoires.
 */

import crypto from 'node:crypto';

/* ----------------------------- Mots de passe ----------------------------- */

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };

function scrypt(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize('NFKC'), salt, keylen, { N, r, p, maxmem: SCRYPT.maxmem }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Format : scrypt$N$r$p$sel$empreinte (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), Number(N), Number(r), Number(p), expected.length);
  return crypto.timingSafeEqual(key, expected);
}

/** Empreinte factice : fait durer la vérification autant pour un email inconnu que connu. */
export const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

/* ------------------------------ Jetons aléatoires ------------------------- */

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

/** Code numérique à `digits` chiffres, sans biais. */
export function randomDigits(digits: number): string {
  let out = '';
  for (let i = 0; i < digits; i++) out += crypto.randomInt(0, 10);
  return out;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/* ----------------------------------- JWT --------------------------------- */

export interface AccessClaims {
  sub: string;
  /** Session (famille de jetons de rafraîchissement). */
  sid: string;
  /** La double authentification a-t-elle été validée pour cette session ? */
  mfa: boolean;
  iat: number;
  exp: number;
}

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

export function signJwt(claims: Omit<AccessClaims, 'iat' | 'exp'>, secret: string, ttlSec: number, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ ...claims, iat, exp: iat + ttlSec })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${HEADER}.${payload}`).digest('base64url');
  return `${HEADER}.${payload}.${sig}`;
}

/** Renvoie les revendications, ou null si le jeton est invalide ou expiré. */
export function verifyJwt(token: string, secret: string, now = Date.now()): AccessClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  // L'en-tête doit être exactement celui que nous émettons : aucun autre algorithme n'est accepté.
  if (header !== HEADER) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AccessClaims;
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') return null;
    if (claims.exp * 1000 <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

/* ----------------------------------- TOTP -------------------------------- */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.toUpperCase().replace(/[=\s]/g, '')) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Base32 invalide');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCode(secretBase32: string, timeMs = Date.now(), step = 30, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 1000 / step)));
  const hmac = crypto.createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Accepte le code courant et ses voisins immédiats (dérive d'horloge de ±30 s). */
export function verifyTotp(secretBase32: string, code: string, timeMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  let ok = false;
  for (const drift of [-1, 0, 1]) {
    if (safeEqual(totpCode(secretBase32, timeMs + drift * 30_000), code)) ok = true;
  }
  return ok;
}

export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

export function otpauthUrl(secret: string, account: string, issuer = 'GROUPDEALS'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/* ------------------------------- AES-256-GCM ------------------------------ */

export function encrypt(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}

export function decrypt(payload: string, key: Buffer): string {
  const [v, iv, tag, data] = payload.split('.');
  if (v !== 'v1') throw new Error('Format de chiffrement inconnu');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

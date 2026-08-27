/**
 * n3xn VFS v2 — Real AES-GCM encryption via Web Crypto API
 * Everything is encrypted at rest (IndexedDB + localStorage exports)
 */

const ALGO = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const ITERATIONS = 310000; // strong PBKDF2

export async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: ALGO, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encrypt(data, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);

  let plain;
  if (typeof data === "string") {
    plain = new TextEncoder().encode(data);
  } else if (data instanceof ArrayBuffer) {
    plain = new Uint8Array(data);
  } else if (data instanceof Uint8Array) {
    plain = data;
  } else {
    plain = new TextEncoder().encode(JSON.stringify(data));
  }

  const cipher = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    plain
  );

  // Format: salt (16) + iv (12) + ciphertext
  const result = new Uint8Array(salt.length + iv.length + cipher.byteLength);
  result.set(salt, 0);
  result.set(iv, salt.length);
  result.set(new Uint8Array(cipher), salt.length + iv.length);
  return result;
}

export async function decrypt(encrypted, password) {
  const bytes = encrypted instanceof Uint8Array ? encrypted : new Uint8Array(encrypted);
  const salt = bytes.slice(0, SALT_LENGTH);
  const iv = bytes.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const data = bytes.slice(SALT_LENGTH + IV_LENGTH);

  const key = await deriveKey(password, salt);
  const plain = await crypto.subtle.decrypt(
    { name: ALGO, iv },
    key,
    data
  );
  return new Uint8Array(plain);
}

export async function encryptToBase64(data, password) {
  const encrypted = await encrypt(data, password);
  return btoa(String.fromCharCode(...encrypted));
}

export async function decryptFromBase64(b64, password) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return decrypt(bytes, password);
}

export function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function hashPassword(password) {
  // For account verification only (never store plain password)
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  // Export a verification hash (we store salt + a derived verification value)
  const verify = await crypto.subtle.exportKey("raw", key);
  return {
    salt: toBase64(salt),
    hash: toBase64(new Uint8Array(verify)),
  };
}

export async function verifyPassword(password, stored) {
  try {
    const salt = fromBase64(stored.salt);
    const key = await deriveKey(password, salt);
    const verify = await crypto.subtle.exportKey("raw", key);
    const hash = toBase64(new Uint8Array(verify));
    return hash === stored.hash;
  } catch {
    return false;
  }
}

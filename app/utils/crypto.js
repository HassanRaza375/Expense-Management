const PBKDF2_ITERATIONS = 150000

function toBase64(bytes) {
  let binary = ''
  const arr = new Uint8Array(bytes)
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i])
  return btoa(binary)
}

function fromBase64(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function randomSaltB64(len = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return toBase64(bytes)
}

async function importPasswordKey(password) {
  const enc = new TextEncoder()
  return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits', 'deriveKey'])
}

// Used by App Lock: one-way hash, not reversible, stored for comparison only.
export async function hashPassword(password, saltB64) {
  const keyMaterial = await importPasswordKey(password)
  const salt = fromBase64(saltB64)
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  )
  return toBase64(bits)
}

export async function verifyPassword(password, saltB64, expectedHashB64) {
  const hash = await hashPassword(password, saltB64)
  return hash === expectedHashB64
}

// Used by Vault: derives an AES-GCM key, never persisted itself.
export async function deriveEncryptionKey(passphrase, saltB64) {
  const keyMaterial = await importPasswordKey(passphrase)
  const salt = fromBase64(saltB64)
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptJSON(data, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const plaintext = enc.encode(JSON.stringify(data))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return { iv: toBase64(iv), ciphertext: toBase64(ciphertext) }
}

export async function decryptJSON(payload, key) {
  const iv = fromBase64(payload.iv)
  const ciphertext = fromBase64(payload.ciphertext)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  const dec = new TextDecoder()
  return JSON.parse(dec.decode(plaintext))
}

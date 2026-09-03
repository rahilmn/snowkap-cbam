import "server-only";

/**
 * Seals the provider session before it is written to the session store.
 *
 * 2026-09-04 (P14, AUTH-1). What is being protected here is narrow and
 * worth stating exactly, because an over-claimed control is worse than
 * a documented one: this makes `public.app_sessions` inert to anyone
 * who obtains the TABLE without also obtaining the application's
 * environment. A leaked backup, a read replica, a dump handed to
 * someone for debugging -- this project's own BACKUP_RESTORE runbook
 * produces exactly such an artifact. It is NOT a defence against an
 * attacker who already holds the service-role key and the environment,
 * and is not claimed as one.
 *
 * WebCrypto rather than node:crypto: this runs in middleware as well as
 * in Server Actions, and Next.js middleware may be evaluated in an
 * Edge-style runtime where node:crypto is unavailable. `crypto.subtle`
 * is present in both.
 *
 * AES-256-GCM, random 96-bit IV per seal, key derived by SHA-256 over
 * APP_SESSION_SECRET. GCM is authenticated, so a tampered row fails to
 * open rather than decrypting to something attacker-chosen.
 */

const VERSION_PREFIX = "v1.";

const IV_BYTES = 12;

/**
 * Required. Deliberately fails closed rather than falling back to
 * storing the provider session in the clear -- a silent fallback is
 * precisely the "hide it differently" outcome this whole change exists
 * to avoid, and it would be invisible in every environment that
 * happened to work.
 */
function readSecret(): string {
  const secret =
    process.env.APP_SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "APP_SESSION_SECRET must be set to at least 32 characters. It seals the " +
        "server-side session store; without it this application cannot hold a " +
        "session safely and deliberately refuses to hold one at all.",
    );
  }

  return secret;
}

let cachedKey: CryptoKey | undefined;

let cachedSecret: string | undefined;

async function sealingKey(): Promise<CryptoKey> {
  const secret =
    readSecret();

  if (cachedKey && cachedSecret === secret) {
    return cachedKey;
  }

  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(secret),
    );

  cachedKey =
    await crypto.subtle.importKey(
      "raw",
      digest,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );

  cachedSecret =
    secret;

  return cachedKey;
}

function toBase64(
  bytes: Uint8Array,
): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function fromBase64(
  value: string,
): Uint8Array {
  const binary =
    atob(value);

  const bytes =
    new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export async function sealProviderSession(
  plaintext: string,
): Promise<string> {
  const key =
    await sealingKey();

  const iv =
    crypto.getRandomValues(
      new Uint8Array(IV_BYTES),
    );

  const ciphertext =
    new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(plaintext),
      ),
    );

  const combined =
    new Uint8Array(iv.length + ciphertext.length);

  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);

  return `${VERSION_PREFIX}${toBase64(combined)}`;
}

/**
 * Returns null rather than throwing when a row cannot be opened -- a
 * session sealed under a rotated secret, or a tampered row. The caller
 * treats that as "no session", which signs the user out rather than
 * failing their request with a stack trace.
 */
export async function openProviderSession(
  sealed: string,
): Promise<string | null> {
  if (!sealed.startsWith(VERSION_PREFIX)) {
    return null;
  }

  try {
    const key =
      await sealingKey();

    const combined =
      fromBase64(
        sealed.slice(VERSION_PREFIX.length),
      );

    if (combined.length <= IV_BYTES) {
      return null;
    }

    const plaintext =
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: combined.slice(0, IV_BYTES),
        },
        key,
        combined.slice(IV_BYTES),
      );

    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

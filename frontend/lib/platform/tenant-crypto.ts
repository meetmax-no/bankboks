/**
 * Ko | Do · Vault — v4.3 Iter 1 — AES-256-GCM kryptering for sentral platform-data
 *
 * Per Spec §11: "Sentral Upstash: kryptert AES-256-GCM".
 * Defense-in-depth: hvis en angriper får tak i CENTRAL_KV_REST_API_TOKEN alene,
 * får de bare opaque ciphertext. Klartekst krever ogsÅ CENTRAL_ENCRYPTION_KEY.
 *
 * Format på lagret blob (base64):
 *   [12 bytes IV][N bytes ciphertext][16 bytes auth-tag]
 * Vi serialiserer som JSON-objekt med base64-felt for å være tydelig.
 *
 * Node runtime — bruker `crypto`-modulen (ikke Web Crypto), fordi server-API
 * uansett kjører i Node og crypto-modulen er enklere/raskere for GCM.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard
const TAG_BYTES = 16; // GCM auth-tag

export type EncryptedBlob = {
  v: 1; // schema-versjon
  iv: string; // base64
  ct: string; // base64 ciphertext
  tag: string; // base64 auth-tag
};

function loadKey(): Buffer {
  const hex = process.env.CENTRAL_ENCRYPTION_KEY ?? "";
  if (!hex) {
    throw new Error(
      "CENTRAL_ENCRYPTION_KEY mangler. Generer med `openssl rand -hex 32` og legg i Vercel env-vars.",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "CENTRAL_ENCRYPTION_KEY må være 64 hex-tegn (32 bytes). Generer på nytt med `openssl rand -hex 32`.",
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Krypter en JSON-serialiserbar payload til en EncryptedBlob.
 */
export function encryptPayload(payload: unknown): EncryptedBlob {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv) as CipherGCM;
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/**
 * Dekrypter en EncryptedBlob tilbake til payload. Kaster ved auth-tag-mismatch
 * (tampering) eller feil schema-versjon.
 */
export function decryptPayload<T>(blob: EncryptedBlob): T {
  if (blob.v !== 1) {
    throw new Error(`Ukjent EncryptedBlob-versjon: ${(blob as { v: number }).v}`);
  }
  const key = loadKey();
  const iv = Buffer.from(blob.iv, "base64");
  const ct = Buffer.from(blob.ct, "base64");
  const tag = Buffer.from(blob.tag, "base64");
  if (iv.length !== IV_BYTES) {
    throw new Error("Ugyldig IV-lengde");
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error("Ugyldig auth-tag-lengde");
  }
  const decipher = createDecipheriv(ALGO, key, iv) as DecipherGCM;
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

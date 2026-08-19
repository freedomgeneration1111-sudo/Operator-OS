import type { GoogleServiceAccountKey } from "../../src/google-calendar";

function toPem(der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

/** Generates a throwaway RSA keypair so JWT-signing code can be exercised without a real Google credential. */
export async function generateTestServiceAccountKey(): Promise<GoogleServiceAccountKey> {
  const { privateKey } = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
  return { client_email: "availability-test@example.iam.gserviceaccount.com", private_key: toPem(pkcs8) };
}

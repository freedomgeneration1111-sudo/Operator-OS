export async function secureTokenMatches(provided: string | null, expected: string | undefined): Promise<boolean> {
  if (!provided || !expected) return false;
  const encoder = new TextEncoder();
  const [providedHash,expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256",encoder.encode(provided)),
    crypto.subtle.digest("SHA-256",encoder.encode(expected)),
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index=0;index<left.length;index+=1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}
export function bearerToken(request: Request) {
  const value = request.headers.get("Authorization");
  return value?.startsWith("Bearer ") ? value.slice(7) : null;
}

import "server-only";
import { resolveBppSigningKey } from "@/lib/ondc/registry-client";

export async function resolveBppSigningPublicKey(
  subscriberId: string,
  uniqueKeyId: string
): Promise<string | null> {
  const result = await resolveBppSigningKey(
    subscriberId,
    uniqueKeyId
  );

  return result.ok
    ? result.signingPublicKey
    : null;
}
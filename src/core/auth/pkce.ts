/** Owns vendor-neutral S256 PKCE and OAuth state generation. */
import { createHash, randomBytes } from "node:crypto";

/** A PKCE verifier and its S256 challenge. */
export interface Pkce {
	readonly verifier: string;
	readonly challenge: string;
}

/** Creates a PKCE pair using 32 random bytes. */
export async function createPkce(
	random: (length: number) => Uint8Array = randomBytes,
): Promise<Pkce> {
	const verifier = randomState(random);
	return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** Creates an opaque OAuth state using 32 random bytes. */
export function randomState(random: (length: number) => Uint8Array = randomBytes): string {
	return Buffer.from(random(32)).toString("base64url");
}

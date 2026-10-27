/** Owns parsing of manually pasted OAuth callback codes and state. */

/** Parses a callback URL, code#state pair, or query string. */
export function parseCodePaste(input: string): { code: string; state: string } | undefined {
	const trimmed = input.trim();
	const url = URL.canParse(trimmed) ? new URL(trimmed) : undefined;
	if (url) {
		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state");
		if (code && state) return { code, state };
	}
	const parts = trimmed.split("#");
	const [code, state] = parts;
	if (parts.length === 2 && code && state) return { code, state };
	const params = new URLSearchParams(trimmed);
	const queryCode = params.get("code");
	const queryState = params.get("state");
	return queryCode && queryState ? { code: queryCode, state: queryState } : undefined;
}

// Test-harness extension: applies the two deltas found in the analysis to Pi's request.
// Not part of the repository; lives in /tmp for the end-to-end verification run.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function sessionId(): string {
	const stamp = Date.now().toString(16).slice(-14).padStart(14, "0");
	let tail = "";
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	for (const byte of bytes) tail += BASE62[byte % 62];
	return `ses_${stamp}${tail}`;
}

export default function harness(pi: ExtensionAPI): void {
	const sid = sessionId();
	pi.on("before_provider_headers", (event) => {
		const has = Object.keys(event.headers).some(
			(key) => key.toLowerCase() === "authorization",
		);
		if (has) event.headers["x-session-affinity"] = sid;
	});

	pi.on("before_provider_request", (event) => {
		const payload = event.payload;
		if (typeof payload !== "object" || payload === null) return;
		const messages = (payload as { messages?: unknown }).messages;
		if (!Array.isArray(messages)) return;
		const first = messages.find(
			(m) => typeof m === "object" && m !== null && (m as { role?: string }).role === "system",
		) as { content?: unknown } | undefined;
		if (!first || typeof first.content !== "string") return;
		first.content = `${first.content}\n\n<env>\n  Working directory: ${process.cwd()}\n  Platform: ${process.platform}\n</env>`;
		return payload;
	});
}

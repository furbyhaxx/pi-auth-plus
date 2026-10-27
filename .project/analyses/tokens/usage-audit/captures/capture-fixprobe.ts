// Throwaway probe: proves Pi persists a same-role message_end usage replacement.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("message_end", async (event) => {
		const message = event.message as Record<string, unknown>;
		if (message.role !== "assistant" || message.provider !== "synthetic") return undefined;
		const usage = message.usage as Record<string, number> | undefined;
		if (!usage) return undefined;
		const cacheWrite = usage.cacheWrite ?? 0;
		const cacheRead = usage.cacheRead ?? 0;
		if (cacheWrite <= 0 || cacheWrite !== usage.input) return undefined;
		const input = Math.max(0, (usage.input ?? 0) - cacheWrite);
		const fixed = {
			...usage,
			input,
			totalTokens: input + (usage.output ?? 0) + cacheRead + cacheWrite,
		};
		return { message: { ...message, usage: fixed } as never };
	});
}

// Throwaway M3 probe: dumps each provider request payload Pi actually sends for
// synthetic, plus the assistant usage Pi persists at message_end.
import { appendFileSync, mkdirSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const dir = process.env.PROBE_DIR ?? "/tmp/m3probe/caps";
mkdirSync(dir, { recursive: true });

function save(name: string, value: unknown): void {
	appendFileSync(`${dir}/${name}.jsonl`, `${JSON.stringify(value)}\n`);
}

export default function probe(pi: ExtensionAPI): void {
	let n = 0;
	pi.on("before_provider_request", (event) => {
		const payload = event.payload as Record<string, unknown> | undefined;
		save("payloads", {
			n: ++n,
			model: payload?.["model"],
			system: payload?.["system"],
			messages: payload?.["messages"],
			tools: payload?.["tools"],
			keys: Object.keys(payload ?? {}),
			other: Object.fromEntries(
				Object.entries(payload ?? {}).filter(
					([k]) =>
						!["model", "system", "messages", "tools"].includes(k),
				),
			),
		});
	});
	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		save("usage", { model: event.message.model, usage: event.message.usage });
	});
}

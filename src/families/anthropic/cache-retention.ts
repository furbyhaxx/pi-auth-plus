/** Anthropic prompt-cache lifetime for selected providers, applied to the outgoing payload. */

/** `default` leaves Pi's request unchanged; `short` is the 5-minute and `long` the 1-hour tier. */
export type CacheRetention = "default" | "short" | "long";

interface SelectedModel {
	readonly provider: string;
	readonly id: string;
	readonly api: string;
	readonly compat?: Readonly<Record<string, unknown>> | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function retimed(
	block: unknown,
	retention: "short" | "long",
): { block: unknown; changed: boolean } {
	if (!isRecord(block) || !isRecord(block["cache_control"])) return { block, changed: false };
	const control = block["cache_control"];
	if (control["type"] !== "ephemeral") return { block, changed: false };
	const { ttl, ...rest } = control;
	if (retention === "long" ? ttl === "1h" : ttl === undefined) return { block, changed: false };
	const next = retention === "long" ? { ...rest, ttl: "1h" } : rest;
	return { block: { ...block, cache_control: next }, changed: true };
}

function retimedList(
	list: unknown,
	retention: "short" | "long",
): { list: unknown; changed: boolean } {
	if (!Array.isArray(list)) return { list, changed: false };
	let changed = false;
	const next = list.map((item) => {
		const result = retimed(item, retention);
		changed ||= result.changed;
		return result.block;
	});
	return { list: changed ? next : list, changed };
}

/**
 * Sets every ephemeral cache breakpoint to the configured lifetime. All breakpoints move together
 * because Anthropic rejects a 1-hour breakpoint that follows a 5-minute one.
 */
export function applyClaudeCacheRetention(
	payload: unknown,
	model: SelectedModel | undefined,
	retention: CacheRetention,
	providers: readonly string[],
): Record<string, unknown> | undefined {
	if (
		retention === "default" ||
		!model ||
		!providers.includes(model.provider) ||
		model.api !== "anthropic-messages" ||
		(retention === "long" && model.compat?.["supportsLongCacheRetention"] === false) ||
		!isRecord(payload) ||
		payload["model"] !== model.id ||
		!Array.isArray(payload["messages"])
	) {
		return undefined;
	}
	const system = retimedList(payload["system"], retention);
	const tools = retimedList(payload["tools"], retention);
	let changed = system.changed || tools.changed;
	const messages = payload["messages"].map((message: unknown) => {
		if (!isRecord(message)) return message;
		const content = retimedList(message["content"], retention);
		if (!content.changed) return message;
		changed = true;
		return { ...message, content: content.list };
	});
	if (!changed) return undefined;
	return {
		...payload,
		...(system.changed ? { system: system.list } : {}),
		...(tools.changed ? { tools: tools.list } : {}),
		messages,
	};
}

/** Read a virtual group's selection and failures from Pi's current session branch. */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ModelIdentity } from "./priority.ts";
import type { GroupRouteState } from "./route.ts";

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function identity(value: unknown): ModelIdentity | undefined {
	const item = record(value);
	return typeof item?.["provider"] === "string" && typeof item["id"] === "string"
		? { provider: item["provider"], id: item["id"] }
		: undefined;
}

function physical(item: ModelIdentity | undefined): item is ModelIdentity {
	return Boolean(item?.provider.trim() && item.provider !== "group" && item.id.trim());
}

function branchState(entries: readonly SessionEntry[], groupId: string) {
	const entry = entries.findLast((item) => {
		if (item.type !== "custom" || item.customType !== "pi.virtual-model-state") return false;
		const data = record(item.data);
		return data?.["provider"] === "group" && data["modelId"] === groupId;
	});
	return entry?.type === "custom" ? record(record(entry.data)?.["state"]) : undefined;
}

function failures(state: Record<string, unknown> | undefined): ModelIdentity[] {
	const rawFailed = state?.["failed"];
	return Array.isArray(rawFailed)
		? rawFailed.flatMap((item: unknown) => {
				const parsed = identity(item);
				return parsed ? [parsed] : [];
			})
		: [];
}

/** Read the latest matching route state, without falling back to an older malformed entry. */
export function readGroupRouteState(
	entries: readonly SessionEntry[],
	groupId: string,
): GroupRouteState | undefined {
	const state = branchState(entries, groupId);
	const selected = identity(state?.["selected"]);
	const rawFailed = state?.["failed"];
	if (!physical(selected) || !Array.isArray(rawFailed)) return undefined;
	const failed = failures(state);
	if (failed.length !== rawFailed.length || failed.some((item) => !physical(item)))
		return undefined;
	return { selected, failed };
}

/** Preserve valid failure exclusions even when the persisted selection is malformed. */
export function readGroupRouteFailures(
	entries: readonly SessionEntry[],
	groupId: string,
): readonly ModelIdentity[] {
	return readGroupRouteState(entries, groupId)?.failed ?? failures(branchState(entries, groupId));
}

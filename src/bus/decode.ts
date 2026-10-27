/** Structural decoders for the public quota bus, independent of the service runtime. */
import type { QuotaEventPayload, QuotaReadyPayload, QuotaSnapshotPayload } from "../quotas/bus.ts";
import type { QuotaReport, ReportProvider } from "../quotas/report.ts";
import type { ResetCredit, ResetCreditList, ResetOutcome } from "../quotas/types.ts";

type RecordValue = Record<string, unknown>;
function record(raw: unknown): raw is RecordValue {
	return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}
function finite(raw: unknown): raw is number {
	return typeof raw === "number" && Number.isFinite(raw);
}
function optionalFields(
	raw: RecordValue,
	keys: readonly string[],
	test: (value: unknown) => boolean,
): boolean {
	return keys.every((key) => raw[key] === undefined || test(raw[key]));
}
function string(raw: unknown): raw is string {
	return typeof raw === "string";
}
function boolean(raw: unknown): raw is boolean {
	return typeof raw === "boolean";
}
function strings(raw: unknown): raw is string[] {
	return Array.isArray(raw) && raw.every(string);
}
function drainage(raw: unknown): boolean {
	return (
		raw === undefined ||
		(record(raw) &&
			finite(raw["observedAt"]) &&
			optionalFields(raw, ["etaSec"], finite) &&
			optionalFields(raw, ["resetsBeforeExhaustion"], boolean) &&
			optionalFields(
				raw,
				["window", "h1", "h24"],
				(rate) => record(rate) && finite(rate["perHour"]) && finite(rate["coverageSec"]),
			))
	);
}
function window(raw: unknown): boolean {
	return (
		record(raw) &&
		string(raw["id"]) &&
		string(raw["shortLabel"]) &&
		string(raw["label"]) &&
		optionalFields(
			raw,
			["usedFraction", "resetAtMs", "usedPercent", "remainingPercent", "resetAt", "resetInSec"],
			finite,
		) &&
		optionalFields(raw, ["valueText", "group", "period", "scope"], string) &&
		optionalFields(raw, ["important"], boolean) &&
		drainage(raw["drainage"])
	);
}
function credits(raw: unknown): boolean {
	return (
		record(raw) &&
		string(raw["currency"]) &&
		optionalFields(raw, ["remaining", "total", "used"], finite) &&
		optionalFields(raw, ["detailText"], string) &&
		drainage(raw["drainage"])
	);
}
function provider(raw: unknown): raw is ReportProvider {
	return (
		record(raw) &&
		string(raw["id"]) &&
		string(raw["title"]) &&
		string(raw["short"]) &&
		["ok", "stale", "error", "needs-auth", "rate-limited", "unknown"].some(
			(state) => raw["state"] === state,
		) &&
		Array.isArray(raw["windows"]) &&
		raw["windows"].every(window) &&
		optionalFields(raw, ["credits"], credits) &&
		optionalFields(raw, ["tier", "error"], string) &&
		optionalFields(raw, ["needsAuth"], boolean) &&
		optionalFields(raw, ["fetchedAt", "ageSec"], finite) &&
		optionalFields(raw, ["resets"], (resets) => record(resets) && finite(resets["available"])) &&
		(raw["source"] === undefined || raw["source"] === "endpoint" || raw["source"] === "headers")
	);
}
/** Decodes a complete versioned quota report. */
export function decodeReport(raw: unknown): QuotaReport | undefined {
	if (
		!record(raw) ||
		raw["v"] !== 1 ||
		!finite(raw["generatedAt"]) ||
		!Array.isArray(raw["providers"]) ||
		!raw["providers"].every(provider)
	)
		return undefined;
	return { v: 1, generatedAt: raw["generatedAt"], providers: raw["providers"] };
}
function resetCredit(raw: unknown): raw is ResetCredit {
	return (
		record(raw) &&
		string(raw["id"]) &&
		string(raw["type"]) &&
		string(raw["status"]) &&
		optionalFields(raw, ["title", "description"], string) &&
		optionalFields(raw, ["grantedAtMs", "expiresAtMs", "redeemedAtMs"], finite) &&
		optionalFields(raw, ["supportedByPlan"], boolean)
	);
}
/** Decodes a reset credit listing including every credit's optional fields. */
export function decodeResets(raw: unknown): ResetCreditList | undefined {
	if (
		!record(raw) ||
		!string(raw["provider"]) ||
		!finite(raw["fetchedAt"]) ||
		!finite(raw["available"]) ||
		!Array.isArray(raw["credits"]) ||
		!raw["credits"].every(resetCredit)
	)
		return undefined;
	return {
		provider: raw["provider"],
		fetchedAt: raw["fetchedAt"],
		available: raw["available"],
		credits: raw["credits"],
	};
}
/** Decodes a provider's reset verdict. */
export function decodeOutcome(raw: unknown): ResetOutcome | undefined {
	if (
		!record(raw) ||
		!string(raw["provider"]) ||
		!string(raw["creditId"]) ||
		!finite(raw["windowsReset"])
	)
		return undefined;
	const code = raw["code"];
	if (
		code !== "reset" &&
		code !== "nothing_to_reset" &&
		code !== "no_credit" &&
		code !== "already_redeemed"
	)
		return undefined;
	return {
		provider: raw["provider"],
		creditId: raw["creditId"],
		windowsReset: raw["windowsReset"],
		code,
	};
}
/** Decodes success or refusal without accepting malformed successes. */
export function decodeReply<T>(
	raw: unknown,
	key: string,
	decode: (value: unknown) => T | undefined,
): { ok: true; value: T } | { ok: false; error: string } | undefined {
	if (!record(raw) || raw["v"] !== 1) return undefined;
	if (raw["ok"] === false && string(raw["error"])) return { ok: false, error: raw["error"] };
	if (raw["ok"] !== true) return undefined;
	const value = decode(raw[key]);
	return value === undefined ? undefined : { ok: true, value };
}
function readyProvider(raw: unknown): raw is QuotaReadyPayload["providers"][number] {
	return record(raw) && string(raw["id"]) && strings(raw["aliases"]);
}
function capability(raw: unknown): raw is QuotaReadyPayload["capabilities"][number] {
	return ["query", "refresh", "resets", "reset", "snapshot", "event"].some((item) => item === raw);
}
/** Decodes the service capability announcement. */
export function decodeReady(raw: unknown): QuotaReadyPayload | undefined {
	if (
		!record(raw) ||
		raw["v"] !== 1 ||
		!Array.isArray(raw["providers"]) ||
		!raw["providers"].every(readyProvider) ||
		!strings(raw["capabilities"]) ||
		!raw["capabilities"].every(capability)
	)
		return undefined;
	return { v: 1, providers: raw["providers"], capabilities: raw["capabilities"] };
}
/** Decodes one changed report row. */
export function decodeSnapshot(raw: unknown): QuotaSnapshotPayload | undefined {
	return record(raw) && raw["v"] === 1 && provider(raw["provider"])
		? { v: 1, provider: raw["provider"] }
		: undefined;
}
/** Decodes actionable service events. */
export function decodeEvent(raw: unknown): QuotaEventPayload | undefined {
	if (!record(raw) || raw["v"] !== 1 || !string(raw["provider"])) return undefined;
	const id = raw["provider"];
	if (raw["kind"] === "auth-required" && optionalFields(raw, ["message"], string))
		return {
			v: 1,
			kind: "auth-required",
			provider: id,
			message: typeof raw["message"] === "string" ? raw["message"] : undefined,
		};
	if (raw["kind"] === "rate-limited" && finite(raw["status"]))
		return { v: 1, kind: "rate-limited", provider: id, status: raw["status"] };
	const requester = raw["requester"];
	if (
		raw["kind"] === "reset-consumed" &&
		raw["code"] === "reset" &&
		finite(raw["windowsReset"]) &&
		(requester === "bus" || requester === "panel" || requester === "command")
	)
		return {
			v: 1,
			kind: "reset-consumed",
			provider: id,
			code: "reset",
			windowsReset: raw["windowsReset"],
			requester,
		};
	return undefined;
}

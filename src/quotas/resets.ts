/** Owns provider-neutral reset credit selection and display wording. */
import { redactText } from "../core/redact/index.ts";
import type { Registry } from "../core/registry/index.ts";
import { plainText } from "./line/values.ts";
import type { ResetCredit, ResetCreditList, ResetOutcome } from "./types.ts";

/** The interactive surface requesting a credit spend. */
export type ResetRequester = "panel" | "command" | "bus";

function plain(text: string): string {
	return redactText(plainText(text));
}

/** Explains which enabled Pi providers support resets. */
export function unsupportedResetMessage(id: string, supportedIds: readonly string[]): string {
	return `${plain(id)} exposes no verified on-demand reset endpoint. Supported: ${supportedIds.join(", ") || "none"}.`;
}

/** Spends the soonest-expiring redeemable credit, keeping the longest-lived credit. */
export function pickResetCredit(list: ResetCreditList, creditId?: string): ResetCredit | undefined {
	const credits = list.credits.filter(
		(credit) => credit.status === "available" && credit.supportedByPlan !== false,
	);
	if (creditId !== undefined) return credits.find((credit) => credit.id === creditId);
	return credits.sort((a, b) => (a.expiresAtMs ?? Infinity) - (b.expiresAtMs ?? Infinity))[0];
}

const dateFormat = new Intl.DateTimeFormat("sv-SE", {
	timeZone: "Europe/Zurich",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
});

/** Formats a reported expiry in Zurich time using a 24-hour clock. */
export function formatResetDate(at: number | undefined): string {
	return at === undefined ? "-" : dateFormat.format(new Date(at));
}

/** Describes a credit without terminal controls or recognizable secrets. */
export function describeResetCredit(credit: ResetCredit): string {
	const expiry =
		credit.expiresAtMs === undefined ? "" : `, expires ${formatResetDate(credit.expiresAtMs)}`;
	return `${plain(credit.title ?? credit.type)} (${plain(credit.status)}${expiry})`;
}

/** Lists all credits under the registry's provider label. */
export function describeResetList(list: ResetCreditList, registry: Registry): string {
	const name = plain(registry.byId(list.provider)?.provider.label ?? list.provider);
	return [
		`${name}: ${list.available} reset credit${list.available === 1 ? "" : "s"} available`,
		...list.credits.map((credit) => `  ${describeResetCredit(credit)}`),
	].join("\n");
}

/** Describes the provider verdict, distinguishing spends from unchanged quotas. */
export function describeResetOutcome(
	outcome: ResetOutcome,
	registry: Registry,
): {
	text: string;
	tone: "info" | "warning";
} {
	const name = plain(registry.byId(outcome.provider)?.provider.label ?? outcome.provider);
	switch (outcome.code) {
		case "reset":
			return {
				text: `${name}: reset applied; ${outcome.windowsReset} window${outcome.windowsReset === 1 ? "" : "s"} reset, one credit spent.`,
				tone: "info",
			};
		case "nothing_to_reset":
			return { text: `${name}: nothing to reset; no credit was spent.`, tone: "warning" };
		case "no_credit":
			return { text: `${name}: no reset credit available; nothing was spent.`, tone: "warning" };
		case "already_redeemed":
			return { text: `${name}: that credit was already redeemed.`, tone: "warning" };
	}
}

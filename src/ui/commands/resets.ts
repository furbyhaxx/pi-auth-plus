/** Owns in-session reset approval and the shared command/panel spend flow. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { redactText } from "../../core/redact/index.ts";
import type { Registry } from "../../core/registry/index.ts";
import type { QuotaEngine } from "../../quotas/engine.ts";
import { plainText } from "../../quotas/line/values.ts";
import type { QuotaReport } from "../../quotas/report.ts";
import {
	describeResetCredit,
	describeResetList,
	describeResetOutcome,
	pickResetCredit,
	type ResetRequester,
	unsupportedResetMessage,
} from "../../quotas/resets.ts";
import type { ResetCredit } from "../../quotas/types.ts";

/** Engine operations used by the interactive reset flow. */
export interface ResetFlowDeps
	extends Pick<QuotaEngine, "resetSupport" | "listResets" | "consumeReset"> {
	report(): QuotaReport;
}

/** Headless-aware reporting supplied by the command router. */
export type ResetReporter = (text: string, tone: "info" | "warning" | "error") => void;

type ResetContext = {
	readonly hasUI: boolean;
	readonly ui: Pick<ExtensionContext["ui"], "select">;
};

/** A safe-first select; absence or dismissal of the UI never authorizes spending. */
export async function confirmReset(
	ctx: ResetContext | undefined,
	id: string,
	credit: ResetCredit,
	requester: ResetRequester,
	report: QuotaReport,
	registry: Registry,
): Promise<boolean> {
	if (!ctx?.hasUI) return false;
	const provider = report.providers.find((provider) => provider.id === id);
	const name = redactText(plainText(registry.byId(id)?.provider.label ?? id));
	const windows = (provider?.windows ?? [])
		.map((window) => {
			const used =
				window.usedFraction === undefined ? "?" : `${Math.round(window.usedFraction * 100)}%`;
			return `${plainText(window.period ?? window.label)} ${used} used`;
		})
		.join(", ");
	const origin = requester === "bus" ? "Another extension requests this reset. " : "";
	const spend = "Spend 1 credit now (cannot be undone)";
	const choice = await ctx.ui.select(
		`${origin}Spend one ${name} reset credit? ${describeResetCredit(credit)}.${windows ? ` Current: ${windows}.` : ""}`,
		["Keep the credit", spend],
	);
	return choice === spend;
}

/** Lists credits, asks once, and consumes at most once; failures are never retried. */
export async function runResetFlow(
	ctx: ResetContext,
	id: string,
	requester: "panel" | "command",
	deps: ResetFlowDeps,
	registry: Registry,
	report: ResetReporter,
): Promise<void> {
	try {
		if (!deps.resetSupport(id)) {
			const supported = registry
				.providers()
				.filter(({ provider }) => deps.resetSupport(provider.id));
			report(
				unsupportedResetMessage(
					id,
					supported.map(({ provider }) => provider.id),
				),
				"warning",
			);
			return;
		}
		const list = await deps.listResets(id);
		const credit = pickResetCredit(list);
		if (!ctx.hasUI || !credit) {
			const reason = !ctx.hasUI
				? "No interactive UI is available; run /quotas reset in an interactive session. No credit was spent."
				: "No redeemable reset credit available; nothing was spent.";
			report(`${describeResetList(list, registry)}\n${reason}`, "info");
			return;
		}
		if (!(await confirmReset(ctx, id, credit, requester, deps.report(), registry))) {
			report("Reset cancelled; no credit was spent.", "info");
			return;
		}
		const outcome = describeResetOutcome(
			await deps.consumeReset(id, credit.id, requester),
			registry,
		);
		report(outcome.text, outcome.tone);
	} catch (error) {
		report(redactText(plainText(error instanceof Error ? error.message : String(error))), "error");
	}
}

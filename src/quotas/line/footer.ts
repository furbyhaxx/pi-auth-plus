/** Owns footer composition with an appended quota row. */
import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { sanitize } from "../../ui/frame/index.ts";
import type { FooterRows } from "./workbench.ts";

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatCwd(cwd: string): string {
	const home = process.env["HOME"] || process.env["USERPROFILE"];
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const rel = relative(resolvedHome, resolvedCwd);
	const isInside = rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
	if (!isInside) return cwd;
	return rel === "" ? "~" : `~${sep}${rel}`;
}

function sanitizeStatusText(text: string): string {
	return sanitize(text)
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/** Session data consumed by the standalone footer. */
export type FooterContext = Pick<ExtensionContext, "model" | "getContextUsage"> & {
	sessionManager: Pick<
		ExtensionContext["sessionManager"],
		"getEntries" | "getLeafId" | "getCwd" | "getSessionName"
	>;
};

/** Recreates the pi-quotas footer, appending the caller's rows after extension statuses. */
export function createFooterWithQuotaLine(
	pi: Pick<ExtensionAPI, "getThinkingLevel">,
	ctx: FooterContext,
	tui: Pick<TUI, "requestRender"> & { terminal: Pick<TUI["terminal"], "rows"> },
	theme: Theme,
	footerData: ReadonlyFooterDataProvider,
	renderQuotaRows: FooterRows,
): Component & { dispose(): void } {
	const unsubBranch = footerData.onBranchChange(() => tui.requestRender());
	let cachedLeafId: string | null | undefined;
	let cachedEntryCount = -1;
	let cachedInput = 0;
	let cachedOutput = 0;
	let cachedRead = 0;
	let cachedWrite = 0;
	let cachedCost = 0;
	let cachedHitRate: number | undefined;

	return {
		dispose() {
			unsubBranch();
		},
		invalidate() {
			cachedEntryCount = -1;
		},
		render(width: number): string[] {
			const sm = ctx.sessionManager;
			const entryCount = sm.getEntries().length;
			const leafId = sm.getLeafId();

			if (entryCount !== cachedEntryCount || leafId !== cachedLeafId) {
				cachedEntryCount = entryCount;
				cachedLeafId = leafId;
				cachedInput = 0;
				cachedOutput = 0;
				cachedRead = 0;
				cachedWrite = 0;
				cachedCost = 0;
				cachedHitRate = undefined;

				for (const entry of sm.getEntries()) {
					if (entry.type === "message" && entry.message.role === "assistant") {
						const m = entry.message;
						cachedInput += m.usage.input || 0;
						cachedOutput += m.usage.output || 0;
						cachedRead += m.usage.cacheRead || 0;
						cachedWrite += m.usage.cacheWrite || 0;
						cachedCost += m.usage.cost?.total || 0;
						const promptTok =
							(m.usage.input || 0) + (m.usage.cacheRead || 0) + (m.usage.cacheWrite || 0);
						cachedHitRate =
							promptTok > 0 ? ((m.usage.cacheRead || 0) / promptTok) * 100 : undefined;
					}
				}
			}

			let pwd = formatCwd(sm.getCwd());
			const branch = footerData.getGitBranch();
			if (branch) pwd = `${pwd} (${branch})`;
			const sessionName = sm.getSessionName();
			if (sessionName) pwd = `${pwd} • ${sessionName}`;

			const statsParts: string[] = [];
			if (cachedInput) statsParts.push(`↑${formatTokens(cachedInput)}`);
			if (cachedOutput) statsParts.push(`↓${formatTokens(cachedOutput)}`);
			if (cachedRead) statsParts.push(`R${formatTokens(cachedRead)}`);
			if (cachedWrite) statsParts.push(`W${formatTokens(cachedWrite)}`);
			if ((cachedRead > 0 || cachedWrite > 0) && cachedHitRate !== undefined) {
				statsParts.push(`CH${cachedHitRate.toFixed(1)}%`);
			}
			if (cachedCost > 0) {
				statsParts.push(`$${cachedCost.toFixed(3)}`);
			}

			const contextUsage = ctx.getContextUsage();
			const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
			const pctVal = contextUsage?.percent ?? 0;
			const pctStr =
				contextUsage?.percent !== null && contextUsage?.percent !== undefined
					? pctVal.toFixed(1)
					: "?";
			const ctxDisplay = `${pctStr}%/${formatTokens(contextWindow)} (auto)`;
			if (pctVal > 90) statsParts.push(theme.fg("error", ctxDisplay));
			else if (pctVal > 70) statsParts.push(theme.fg("warning", ctxDisplay));
			else statsParts.push(ctxDisplay);

			let statsLeft = statsParts.join(" ");
			let statsLeftWidth = visibleWidth(statsLeft);
			if (statsLeftWidth > width) {
				statsLeft = truncateToWidth(statsLeft, width, "...");
				statsLeftWidth = visibleWidth(statsLeft);
			}

			const modelName = ctx.model?.id || "no-model";
			const thinking = pi.getThinkingLevel();
			let rightSide = ctx.model?.reasoning
				? thinking === "off"
					? `${modelName} • thinking off`
					: `${modelName} • ${thinking}`
				: modelName;
			if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
				const withProv = `(${ctx.model.provider}) ${rightSide}`;
				if (statsLeftWidth + 2 + visibleWidth(withProv) <= width) {
					rightSide = withProv;
				}
			}

			const rightWidth = visibleWidth(rightSide);
			const statsLine =
				statsLeftWidth + 2 + rightWidth <= width
					? theme.fg("dim", statsLeft) +
						theme.fg("dim", " ".repeat(width - statsLeftWidth - rightWidth) + rightSide)
					: theme.fg("dim", statsLeft);

			const lines = [
				truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")),
				statsLine,
			];

			const extStatuses = footerData.getExtensionStatuses();
			if (extStatuses.size > 0) {
				const sorted = Array.from(extStatuses.entries())
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([, text]) => sanitizeStatusText(text));
				lines.push(truncateToWidth(sorted.join(" "), width, theme.fg("dim", "...")));
			}

			lines.push(...renderQuotaRows(width, theme, tui.terminal.rows));
			return lines;
		},
	};
}

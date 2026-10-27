/** pi-workbench's footer host: when present it owns the footer, and quota rows join it. */
import type { Theme } from "@earendil-works/pi-coding-agent";

/** Rows appended to the serving footer at its current width and terminal height. */
export type FooterRows = (width: number, theme: Theme, terminalRows: number) => string[];

/** The part of `WorkbenchServiceV1` (pi-workbench) the quota footer rows use. */
export interface WorkbenchFooterHost {
	setFooterRows(key: string, rows: FooterRows | undefined): void;
	requestFooterRender(): void;
}

/** Accept a `workbench:service` payload only if it offers footer rows. */
export function asFooterHost(value: unknown): WorkbenchFooterHost | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const host = value as Partial<Record<keyof WorkbenchFooterHost, unknown>>;
	if (typeof host.setFooterRows !== "function" || typeof host.requestFooterRender !== "function")
		return undefined;
	return value as WorkbenchFooterHost;
}

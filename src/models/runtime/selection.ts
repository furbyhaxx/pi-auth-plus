/** Guarded automatic model selection for the current catalog lifetime. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Model = Parameters<ExtensionAPI["setModel"]>[0];
type GuardedSelectionAPI = ExtensionAPI & {
	setModelIfCurrent(model: Model, signal: AbortSignal): Promise<boolean>;
};

function supportsGuardedSelection(pi: ExtensionAPI): pi is GuardedSelectionAPI {
	return "setModelIfCurrent" in pi && typeof pi.setModelIfCurrent === "function";
}

/** Selects only through a host that can enforce the supplied lifetime. */
export async function selectModelIfCurrent(
	pi: ExtensionAPI,
	model: Model,
	signal: AbortSignal,
): Promise<"selected" | "not-applied" | "unsupported"> {
	if (signal.aborted) return "not-applied";
	if (!supportsGuardedSelection(pi)) return "unsupported";
	return (await pi.setModelIfCurrent(model, signal)) ? "selected" : "not-applied";
}

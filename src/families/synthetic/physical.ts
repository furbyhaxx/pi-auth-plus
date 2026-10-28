/** Request-local payload rewriting and usage correction for Synthetic models. */
import type { Api, Model } from "@earendil-works/pi-ai";
import { type ModelAlias, rewriteAliasPayload } from "../../models/aliases/index.ts";
import type { PhysicalRequestHooks } from "../../models/runtime/physical.ts";
import type { TokenizerStore } from "../../tokens/types.ts";
import { PROVIDER } from "./catalog.ts";
import { requestModel, syntheticTokenizerRepo } from "./request-tokens.ts";
import { correctSyntheticRequestUsage } from "./usage.ts";

/** Creates isolated Synthetic hooks for one physical request. */
export function syntheticPhysicalHooks(
	model: Model<Api>,
	aliases: readonly ModelAlias[],
	tokenizers?: TokenizerStore,
): PhysicalRequestHooks | undefined {
	if (model.provider !== PROVIDER) return undefined;
	const alias = aliases.find((entry) => entry.provider === model.provider && entry.id === model.id);
	const source = alias?.source ?? model.id;
	const repo = syntheticTokenizerRepo(source);
	if (repo) void tokenizers?.load(repo);
	let logicalPayload: unknown;
	return {
		payload: (payload) => {
			logicalPayload = payload;
			return rewriteAliasPayload(payload, model, aliases);
		},
		message: (message) => {
			if (
				message.provider !== model.provider ||
				message.model !== model.id ||
				requestModel(logicalPayload) !== model.id
			)
				return undefined;
			return correctSyntheticRequestUsage(message, logicalPayload, tokenizers, source);
		},
	};
}

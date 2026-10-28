/** Request-local OpenCode CLI identity for verified physical models. */
import type { Api, Model } from "@earendil-works/pi-ai";
import type { PhysicalRequestHooks } from "../../models/runtime/physical.ts";
import { applyCliEnv, applyCliIdentity, envBlock } from "./identity.ts";
import { GO_PROVIDER, ZEN_PROVIDER } from "./index.ts";

export function opencodePhysicalHooks(
	model: Model<Api>,
	cwd: string,
	sessionId: string,
): PhysicalRequestHooks | undefined {
	if (
		model.api === "pi-virtual" ||
		(model.provider !== ZEN_PROVIDER && model.provider !== GO_PROVIDER)
	)
		return undefined;
	return {
		headers: (headers) => {
			const copy = { ...headers };
			applyCliIdentity(copy, sessionId, true);
			return copy;
		},
		payload: (payload, actualModel) => {
			if (
				actualModel.provider !== model.provider ||
				actualModel.id !== model.id ||
				typeof payload !== "object" ||
				payload === null ||
				!("model" in payload) ||
				payload.model !== actualModel.id ||
				!("messages" in payload) ||
				!Array.isArray(payload.messages)
			)
				return undefined;
			const copy = {
				...payload,
				messages: payload.messages.map((message: unknown) => {
					if (typeof message !== "object" || message === null || Array.isArray(message))
						return message;
					if ("content" in message && Array.isArray(message.content))
						return { ...message, content: [...message.content] };
					return { ...message };
				}),
			};
			return applyCliEnv(copy, envBlock(cwd, process.platform)) ? copy : undefined;
		},
	};
}

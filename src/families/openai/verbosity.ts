type Verbosity = "default" | "low" | "medium" | "high";

interface SelectedModel {
	readonly provider: string;
	readonly id: string;
	readonly api: string;
	readonly samplingParams?: Readonly<Record<string, unknown>> | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Apply the configured response verbosity without disturbing structured output settings. */
export function applyOpenaiVerbosity(
	payload: unknown,
	model: SelectedModel | undefined,
	verbosity: Verbosity,
	providers: readonly string[],
): Record<string, unknown> | undefined {
	const override = isRecord(model?.samplingParams?.["text"])
		? model?.samplingParams?.["text"]["verbosity"]
		: undefined;
	const effective =
		override === "low" || override === "medium" || override === "high" ? override : verbosity;
	if (
		effective === "default" ||
		!model ||
		!providers.includes(model.provider) ||
		(model.api !== "openai-responses" && model.api !== "openai-codex-responses") ||
		!isRecord(payload) ||
		payload["model"] !== model.id ||
		!Array.isArray(payload["input"]) ||
		(payload["text"] !== undefined && !isRecord(payload["text"]))
	) {
		return undefined;
	}
	return {
		...payload,
		text: { ...(isRecord(payload["text"]) ? payload["text"] : {}), verbosity: effective },
	};
}

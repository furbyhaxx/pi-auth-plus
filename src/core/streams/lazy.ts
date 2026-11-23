/**
 * A provider stream returned before async setup finishes. Hosts differ in what they export
 * (`lazyStream` is missing from oh-my-pi's bundled pi-ai), so the seam lives here.
 */
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
	type Model,
} from "@earendil-works/pi-ai";

/** Sees every forwarded event and the final result, for request-local bookkeeping. */
export interface LazyStreamObserver {
	onEvent?(event: AssistantMessageEvent): void;
	onResult?(result: AssistantMessage): void;
}

interface ResultSource extends AsyncIterable<AssistantMessageEvent> {
	result(): Promise<AssistantMessage>;
}

function hasResult(source: AsyncIterable<AssistantMessageEvent>): source is ResultSource {
	return typeof (source as Partial<ResultSource>).result === "function";
}

function setupFailure(model: Model<Api>, error: unknown, timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp,
	};
}

/** Returns a stream synchronously and runs `setup` behind it; a failure ends it with an error event. */
export function lazyStream(
	model: Model<Api>,
	setup: () => Promise<AsyncIterable<AssistantMessageEvent>>,
	observer?: LazyStreamObserver,
): AssistantMessageEventStream {
	const startedAt = Date.now();
	const outer = createAssistantMessageEventStream();
	let observed = false;
	const observe = (result: AssistantMessage): void => {
		if (observed) return;
		observed = true;
		observer?.onResult?.(result);
	};
	setup()
		.then(async (inner) => {
			let result: AssistantMessage | undefined;
			for await (const event of inner) {
				outer.push(event);
				observer?.onEvent?.(event);
				if (event.type === "done") result = event.message;
				else if (event.type === "error") result = event.error;
			}
			if (hasResult(inner)) result = await inner.result();
			outer.end(result);
			if (result) observe(result);
		})
		.catch((error: unknown) => {
			const message = setupFailure(model, error, startedAt);
			const event = { type: "error", reason: "error", error: message } as const;
			outer.push(event);
			observer?.onEvent?.(event);
			outer.end(message);
			observe(message);
		});
	return outer;
}

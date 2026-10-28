/** Request-local hooks around Pi's physical model runtime. */
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type Context,
	lazyStream,
	type Model,
	type ModelsSimpleStreamOptions,
	type ProviderHeaders,
	type ProviderResponse,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export interface PhysicalRequestHooks {
	headers?: (headers: ProviderHeaders) => ProviderHeaders | Promise<ProviderHeaders>;
	payload?: (payload: unknown, actualModel: Model<Api>) => unknown | Promise<unknown>;
	response?: (response: ProviderResponse, actualModel: Model<Api>) => void | Promise<void>;
	message?: (message: AssistantMessage) => AssistantMessage | undefined;
}

export type PhysicalRequestFactory = (
	model: Model<Api>,
	context: Context,
) => PhysicalRequestHooks | undefined;

type Dispatch = (
	model: Model<Api>,
	context: Context,
	options?: ModelsSimpleStreamOptions,
) => AssistantMessageEventStream;
type Runtime = Pick<ModelRuntime, "stream" | "streamSimple">;
type State = { factory: PhysicalRequestFactory };
const marker = Symbol.for("pi-auth-plus.physical-request-hooks");

function mapMessages(
	model: Model<Api>,
	source: AssistantMessageEventStream,
	map: NonNullable<PhysicalRequestHooks["message"]>,
): AssistantMessageEventStream {
	const cache = new WeakMap<AssistantMessage, AssistantMessage>();
	const correct = (message: AssistantMessage): AssistantMessage => {
		const existing = cache.get(message);
		if (existing) return existing;
		const result = map(message) ?? message;
		cache.set(message, result);
		return result;
	};
	let failure: { error: unknown } | undefined;
	async function* events(): AsyncGenerator<AssistantMessageEvent> {
		try {
			for await (const event of source) {
				if (event.type === "done") {
					const message = correct(event.message);
					yield message === event.message ? event : { ...event, message };
				} else if (event.type === "error") {
					const error = correct(event.error);
					yield error === event.error ? event : { ...event, error };
				} else yield event;
			}
		} catch (error) {
			failure = { error };
			throw error;
		}
	}
	let failureEvent: AssistantMessageEvent | undefined;
	const mapped = lazyStream(model, async () => events(), {
		onEvent: (event) => {
			if (failure) failureEvent = event;
		},
	});
	const iterate = mapped[Symbol.asyncIterator].bind(mapped);
	mapped[Symbol.asyncIterator] = async function* () {
		for await (const event of { [Symbol.asyncIterator]: iterate }) {
			if (event === failureEvent && failure) throw failure.error;
			yield event;
		}
	};
	mapped.result = () => source.result().then(correct);
	return mapped;
}

function wrap(original: Dispatch, state: State): Dispatch {
	return function (this: Runtime, ...args: Parameters<Dispatch>) {
		const [model, context, options] = args;
		if (model.api === "pi-virtual") return Reflect.apply(original, this, args);
		const hooks = state.factory(model, context);
		if (!hooks) return Reflect.apply(original, this, args);
		const transformed = { ...options };
		if (hooks.headers) {
			const handler = hooks.headers;
			const previous = options?.transformHeaders;
			transformed.transformHeaders = async (headers) =>
				handler(previous ? await previous(headers) : headers);
		}
		if (hooks.payload) {
			const handler = hooks.payload;
			const previous = options?.onPayload;
			transformed.onPayload = async (payload, actualModel) => {
				const prior = previous ? await previous(payload, actualModel) : undefined;
				const value = prior === undefined ? payload : prior;
				const result = await handler(value, actualModel);
				return result === undefined ? value : result;
			};
		}
		if (hooks.response) {
			const handler = hooks.response;
			const previous = options?.onResponse;
			transformed.onResponse = async (response, actualModel) => {
				if (previous) await previous(response, actualModel);
				await handler(response, actualModel);
			};
		}
		if (hooks.headers || hooks.payload || hooks.response) args[2] = transformed;
		const stream = Reflect.apply(original, this, args);
		return hooks.message ? mapMessages(model, stream, hooks.message) : stream;
	};
}

export function installPhysicalRequestHooks(
	registry: unknown,
	factory: PhysicalRequestFactory,
): boolean {
	try {
		if (typeof registry !== "object" || registry === null || !("runtime" in registry)) return false;
		const runtime: unknown = registry.runtime;
		if (typeof runtime !== "object" || runtime === null) return false;
		const stateDescriptor = Object.getOwnPropertyDescriptor(runtime, marker);
		if (stateDescriptor) {
			const state: unknown = stateDescriptor.value;
			if (
				typeof state !== "object" ||
				state === null ||
				!("factory" in state) ||
				typeof state.factory !== "function"
			)
				return false;
			return Reflect.set(state, "factory", factory);
		}
		if (!Object.isExtensible(runtime) || !("stream" in runtime) || !("streamSimple" in runtime))
			return false;
		if (typeof runtime.stream !== "function" || typeof runtime.streamSimple !== "function")
			return false;
		const streamDescriptor = Object.getOwnPropertyDescriptor(runtime, "stream");
		const simpleDescriptor = Object.getOwnPropertyDescriptor(runtime, "streamSimple");
		if (
			(streamDescriptor && !streamDescriptor.configurable) ||
			(simpleDescriptor && !simpleDescriptor.configurable)
		)
			return false;
		const state: State = { factory };
		const originalStream = runtime.stream as Dispatch;
		const originalSimple = runtime.streamSimple as Dispatch;
		try {
			Object.defineProperties(runtime, {
				stream: { value: wrap(originalStream, state), configurable: true, writable: true },
				streamSimple: { value: wrap(originalSimple, state), configurable: true, writable: true },
				[marker]: { value: state, configurable: true },
			});
		} catch {
			if (streamDescriptor) Object.defineProperty(runtime, "stream", streamDescriptor);
			else Reflect.deleteProperty(runtime, "stream");
			if (simpleDescriptor) Object.defineProperty(runtime, "streamSimple", simpleDescriptor);
			else Reflect.deleteProperty(runtime, "streamSimple");
			Reflect.deleteProperty(runtime, marker);
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

/** Guarded RPC startup catalog refresh coordination for the verified Pi builds. */
import type { ModelsRefreshOptions, ModelsRefreshResult } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

interface RuntimeState {
	initialized: boolean;
	startup: boolean;
	entered: boolean;
	conflict: boolean;
	failOpen: boolean;
	pending: Set<Promise<ModelsRefreshResult>>;
	stopped: AbortController;
	ready: Promise<void>;
	release: () => void;
}

/** Coordinates only the startup refresh belonging to a session runtime. */
export interface StartupCoordinator {
	ready(runtime: ModelRuntime | undefined): boolean;
	stop(runtime: ModelRuntime): void;
}

interface Installation {
	refresh: ModelRuntime["refresh"];
	coordinator: StartupCoordinator;
}

const marker = Symbol.for("pi-auth-plus.rpc-startup-refresh.v1");
const stockCaller =
	/^\s*at main \(file:\/\/.*\/dist\/bundle\/chunks\/chunk-MM3LKT73\.js:1222:18193\)$/u;
const boltCaller = /^\s*at main2 \(\/\$bunfs\/root\/entry-[a-z0-9]+\.js:11261:25\)$/u;

function callerFrame(): string {
	return new Error().stack?.split("\n")[3] ?? "";
}

function waitFor(promise: Promise<unknown>, signal: AbortSignal): Promise<boolean> {
	if (signal.aborted) return Promise.resolve(false);
	return new Promise((resolve, reject) => {
		const abort = () => resolve(false);
		signal.addEventListener("abort", abort, { once: true });
		promise.then(
			() => {
				signal.removeEventListener("abort", abort);
				resolve(true);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", abort);
				reject(error);
			},
		);
	});
}

/** Installs once, leaving unknown or previously patched host prototypes untouched. */
export function installStartupCoordinator(
	prototype: ModelRuntime,
	frame: () => string = callerFrame,
): StartupCoordinator | undefined {
	const tagged = prototype as ModelRuntime & { [marker]?: Installation };
	const installed = tagged[marker];
	if (installed) return prototype.refresh === installed.refresh ? installed.coordinator : undefined;
	const original = prototype.refresh;
	const descriptor = Object.getOwnPropertyDescriptor(prototype, "refresh");
	if (
		typeof original !== "function" ||
		original.name !== "refresh" ||
		!descriptor?.writable ||
		!Object.isExtensible(prototype)
	)
		return undefined;
	const states = new WeakMap<ModelRuntime, RuntimeState>();
	let sessionSeen = false;
	let candidateState: RuntimeState | undefined;
	function state(runtime: ModelRuntime): RuntimeState {
		const existing = states.get(runtime);
		if (existing) return existing;
		let release = () => {};
		const ready = new Promise<void>((resolve) => {
			release = resolve;
		});
		const created: RuntimeState = {
			initialized: false,
			startup: false,
			entered: false,
			conflict: false,
			failOpen: false,
			pending: new Set(),
			stopped: new AbortController(),
			ready,
			release,
		};
		states.set(runtime, created);
		return created;
	}
	const coordinator: StartupCoordinator = {
		ready(runtime) {
			sessionSeen = true;
			const current = runtime ? state(runtime) : undefined;
			current?.release();
			if (candidateState && candidateState !== current) {
				candidateState.failOpen = true;
				candidateState.release();
			}
			return current?.startup ?? false;
		},
		stop(runtime) {
			state(runtime).stopped.abort();
		},
	};
	const wrapped: ModelRuntime["refresh"] = function (
		this: ModelRuntime,
		options: ModelsRefreshOptions = {},
	) {
		const current = state(this);
		const keys = Reflect.ownKeys(options);
		const signal = options.signal;
		const caller = signal && keys.length === 1 && keys[0] === "signal" ? frame() : "";
		const candidate =
			!sessionSeen &&
			!current.startup &&
			current.initialized &&
			signal instanceof AbortSignal &&
			(stockCaller.test(caller) || boltCaller.test(caller));
		if (candidate && signal) {
			current.startup = true;
			candidateState = current;
			const owner = AbortSignal.any([signal, current.stopped.signal]);
			return (async () => {
				const aborted = (): ModelsRefreshResult => ({ aborted: true, errors: new Map() });
				if (!(await waitFor(current.ready, owner))) return aborted();
				if (owner.aborted) return aborted();
				if (current.failOpen) return original.call(this, options);
				while (current.pending.size > 0) {
					if (!(await waitFor(Promise.allSettled([...current.pending]), owner))) return aborted();
				}
				if (owner.aborted || current.conflict) return aborted();
				current.entered = true;
				return original.call(this, { ...options, signal: owner });
			})();
		}
		if (current.startup && !current.entered && options.allowNetwork !== false)
			current.conflict = true;
		const operation = original.call(this, options);
		if (options.allowNetwork === false) {
			current.initialized = true;
			current.pending.add(operation);
			void operation.then(
				() => current.pending.delete(operation),
				() => current.pending.delete(operation),
			);
		}
		return operation;
	};
	prototype.refresh = wrapped;
	Object.defineProperty(prototype, marker, {
		value: { refresh: wrapped, coordinator } satisfies Installation,
	});
	return coordinator;
}

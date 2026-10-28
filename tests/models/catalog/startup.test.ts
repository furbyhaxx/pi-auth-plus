import { expect, test } from "bun:test";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { installStartupCoordinator } from "../../../src/models/catalog/startup.ts";

const startupFrame = "    at main (file:///tmp/dist/bundle/chunks/chunk-MM3LKT73.js:1222:18193)";
const otherFrame = "    at other (/tmp/extension.ts:1:1)";

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function fixture() {
	const calls: { options: Record<string, unknown>; runtime: Runtime }[] = [];
	const offline = deferred();
	const network = deferred();
	const networkStarted = deferred();
	let slowOffline = false;
	let slowNetwork = false;
	let frame = otherFrame;
	class Runtime {
		async refresh(options: Record<string, unknown> = {}) {
			calls.push({ options, runtime: this });
			if (options["allowNetwork"] === false && slowOffline) await offline.promise;
			if (options["signal"] && slowNetwork) {
				networkStarted.resolve();
				await network.promise;
			}
			const signal = options["signal"];
			return { aborted: signal instanceof AbortSignal && signal.aborted, errors: new Map() };
		}
	}
	const coordinator = installStartupCoordinator(
		Runtime.prototype as unknown as ModelRuntime,
		() => frame,
	);
	if (!coordinator) throw new Error("installation failed");
	return {
		Runtime,
		coordinator,
		calls,
		offline,
		network,
		networkStarted,
		slowNetwork: () => {
			slowNetwork = true;
		},
		setFrame: (value: string) => {
			frame = value;
		},
		slow: () => {
			slowOffline = true;
		},
	};
}

test("holds the startup call until own readiness and offline refreshes drain", async () => {
	const f = fixture();
	const runtime = new f.Runtime();
	await runtime.refresh({ allowNetwork: false });
	f.setFrame(startupFrame);
	const signal = new AbortController().signal;
	const startup = runtime.refresh({ signal });
	expect(f.calls).toHaveLength(1);
	f.slow();
	const pending = runtime.refresh({ allowNetwork: false });
	f.coordinator.ready(runtime as unknown as ModelRuntime);
	await Promise.resolve();
	expect(f.calls).toHaveLength(2);
	f.offline.resolve();
	await pending;
	expect((await startup).aborted).toBe(false);
	expect(f.calls).toHaveLength(3);
	const forwarded = f.calls[2]?.options["signal"];
	expect(forwarded).toBeInstanceOf(AbortSignal);
	if (!(forwarded instanceof AbortSignal)) throw new Error("missing signal");
	expect(forwarded.aborted).toBe(false);
});

test("cancellation and shutdown skip a held startup without entering the host", async () => {
	for (const shutdown of [false, true]) {
		const f = fixture();
		const runtime = new f.Runtime();
		await runtime.refresh({ allowNetwork: false });
		f.setFrame(startupFrame);
		const controller = new AbortController();
		const startup = runtime.refresh({ signal: controller.signal });
		if (shutdown) f.coordinator.stop(runtime as unknown as ModelRuntime);
		else controller.abort();
		expect((await startup).aborted).toBe(true);
		expect(f.calls).toHaveLength(1);
	}
});

test("an aborted startup does not wait for offline work", async () => {
	const f = fixture();
	const runtime = new f.Runtime();
	await runtime.refresh({ allowNetwork: false });
	f.setFrame(startupFrame);
	const controller = new AbortController();
	const startup = runtime.refresh({ signal: controller.signal });
	f.slow();
	const pending = runtime.refresh({ allowNetwork: false });
	f.coordinator.ready(runtime as unknown as ModelRuntime);
	controller.abort();
	expect((await startup).aborted).toBe(true);
	expect(f.calls).toHaveLength(2);
	f.offline.resolve();
	await pending;
});

test("other callers and uninitialized runtimes pass through unchanged", async () => {
	const f = fixture();
	const other = new f.Runtime();
	f.setFrame(startupFrame);
	const signal = new AbortController().signal;
	await other.refresh({ signal });
	expect(f.calls[0]?.options["signal"]).toBe(signal);
	await other.refresh({ allowNetwork: false, signal });
	f.setFrame(otherFrame);
	await other.refresh({ signal });
	expect(f.calls).toHaveLength(3);
});

test("forwards cancellation after entry and never starts a second fetch", async () => {
	const f = fixture();
	const runtime = new f.Runtime();
	await runtime.refresh({ allowNetwork: false });
	f.setFrame("    at main2 (/$bunfs/root/entry-xpeyq4hv.js:11261:25)");
	f.slowNetwork();
	const controller = new AbortController();
	const startup = runtime.refresh({ signal: controller.signal });
	f.coordinator.ready(runtime as unknown as ModelRuntime);
	await f.networkStarted.promise;
	expect(f.calls).toHaveLength(2);
	f.coordinator.stop(runtime as unknown as ModelRuntime);
	f.network.resolve();
	expect((await startup).aborted).toBe(true);
	expect(f.calls).toHaveLength(2);
});

test("unavailable session runtime fails open without waiting for offline work", async () => {
	const f = fixture();
	const runtime = new f.Runtime();
	await runtime.refresh({ allowNetwork: false });
	f.setFrame(startupFrame);
	const signal = new AbortController().signal;
	const startup = runtime.refresh({ signal });
	f.slow();
	const pending = runtime.refresh({ allowNetwork: false });
	expect(f.coordinator.ready(undefined)).toBe(false);
	await startup;
	expect(f.calls[2]?.options["signal"]).toBe(signal);
	f.offline.resolve();
	await pending;
});

test("an unrelated initialized runtime passes through while startup is held", async () => {
	const f = fixture();
	const runtime = new f.Runtime();
	const other = new f.Runtime();
	await runtime.refresh({ allowNetwork: false });
	await other.refresh({ allowNetwork: false });
	f.setFrame(startupFrame);
	const startup = runtime.refresh({ signal: new AbortController().signal });
	f.setFrame(otherFrame);
	const signal = new AbortController().signal;
	await other.refresh({ signal });
	expect(f.calls[2]?.runtime).toBe(other);
	expect(f.calls[2]?.options["signal"]).toBe(signal);
	f.coordinator.ready(runtime as unknown as ModelRuntime);
	await startup;
	expect(f.calls).toHaveLength(4);
});

test("skips startup after a competing refresh and passes the competitor through", async () => {
	const f = fixture();
	const runtime = new f.Runtime();
	await runtime.refresh({ allowNetwork: false });
	f.setFrame(startupFrame);
	const startup = runtime.refresh({ signal: new AbortController().signal });
	f.setFrame(otherFrame);
	const signal = new AbortController().signal;
	await runtime.refresh({ signal });
	f.coordinator.ready(runtime as unknown as ModelRuntime);
	expect((await startup).aborted).toBe(true);
	expect(f.calls).toHaveLength(2);
	expect(f.calls[1]?.options["signal"]).toBe(signal);
});

test("rejects unsupported or subsequently replaced refresh wrappers", () => {
	class Runtime {
		async patched() {
			return { aborted: false, errors: new Map() };
		}
	}
	const prototype = Runtime.prototype as unknown as ModelRuntime;
	expect(installStartupCoordinator(prototype)).toBeUndefined();
	const f = fixture();
	const existing = f.Runtime.prototype.refresh;
	f.Runtime.prototype.refresh = async () => ({ aborted: false, errors: new Map() });
	expect(installStartupCoordinator(f.Runtime.prototype as unknown as ModelRuntime)).toBeUndefined();
	f.Runtime.prototype.refresh = existing;
});

test("reload reuses the wrapper and no tool or registration methods are touched", async () => {
	const f = fixture();
	const refresh = f.Runtime.prototype.refresh;
	const again = installStartupCoordinator(
		f.Runtime.prototype as unknown as ModelRuntime,
		() => startupFrame,
	);
	expect(again).toBe(f.coordinator);
	expect(f.Runtime.prototype.refresh).toBe(refresh);
	expect(Object.getOwnPropertyNames(f.Runtime.prototype)).toEqual(["constructor", "refresh"]);
});

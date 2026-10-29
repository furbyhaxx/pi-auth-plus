import { appendFileSync } from "node:fs";

const emit = (event: string, details: Record<string, unknown> = {}) => {
	appendFileSync(process.env["RACE_TRACE"]!, `${JSON.stringify({ event, at: Date.now(), ...details })}\n`);
};

const rows = ["race-visible", "race-hidden"].map((id) => ({
	id,
	name: id,
	always_on: true,
	context_length: 100000,
	max_output_length: 4096,
	supported_features: ["tools"],
	pricing: { prompt: "0", completion: "0" },
}));

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	if (url.origin !== "https://api.synthetic.new" || url.pathname !== "/v1/models") {
		emit("blocked-other-network", { host: url.hostname, path: url.pathname });
		return new Response("blocked by isolated reproduction", { status: 503 });
	}
	emit("fetch-start");
	const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
	return await new Promise<Response>((resolve, reject) => {
		const timer = setTimeout(() => {
			emit("fetch-resolve");
			resolve(new Response(JSON.stringify({ data: rows }), { status: 200 }));
		}, 800);
		const abort = () => {
			clearTimeout(timer);
			emit("fetch-abort");
			reject(new DOMException("aborted", "AbortError"));
		};
		if (signal?.aborted) abort();
		else signal?.addEventListener("abort", abort, { once: true });
	});
};

export default function (pi: any) {
	pi.on("session_start", async (_event: unknown, ctx: any) => {
		emit("before-session", { mode: ctx.mode, trusted: ctx.isProjectTrusted() });
		const runtime = ctx.modelRegistry.runtime;
		const pending = new Set<Promise<unknown>>();
		(globalThis as any).__racePendingRefreshes = pending;
		if (runtime?.refresh) {
			const refresh = runtime.refresh.bind(runtime);
			runtime.refresh = (options: any) => {
				emit("registry-refresh", {
					allowNetwork: options?.allowNetwork ?? "default",
					providers: options?.providers ?? "all",
					caller: new Error().stack?.split("\n").slice(2, 4).map((line) => line.trim()),
				});
				const delay = Number(process.env["RACE_DELAY_IMPLICIT_MS"] ?? "0");
				let operation: Promise<unknown>;
				if (delay > 0 && options?.allowNetwork === false && !options?.providers) {
					emit("delay-implicit-refresh", { delay });
					operation = new Promise((resolve) => setTimeout(resolve, delay)).then(() => refresh(options));
				} else {
					operation = refresh(options);
				}
				if (options?.allowNetwork === false) {
					pending.add(operation);
					void operation.then(() => pending.delete(operation), () => pending.delete(operation));
				}
				return operation;
			};
		} else emit("no-refresh-spy");
		const delay = Number(process.env["RACE_DELAY_MS"] ?? "0");
		if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
	});
}

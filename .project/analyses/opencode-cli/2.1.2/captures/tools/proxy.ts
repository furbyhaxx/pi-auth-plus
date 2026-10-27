// Throwaway logging reverse proxy for OpenCode Zen captures.
// Usage: bun proxy.ts <port> <label> <captureDir>
const port = Number(process.argv[2] ?? "18900");
const label = process.argv[3] ?? "cli";
const dir = process.argv[4] ?? `/tmp/zenproxy/${label}`;
const UPSTREAM = "https://opencode.ai";

const HOP = new Set([
	"host",
	"connection",
	"content-length",
	"accept-encoding",
	"keep-alive",
	"transfer-encoding",
	"upgrade",
	"proxy-authorization",
	"proxy-connection",
]);

await Bun.$`mkdir -p ${dir}`.quiet();
let n = 0;

const server = Bun.serve({
	port,
	async fetch(req) {
		const id = String(++n).padStart(3, "0");
		const url = new URL(req.url);
		const bodyBuf = await req.arrayBuffer();
		const body = new TextDecoder().decode(bodyBuf);
		const headers: Record<string, string> = {};
		for (const [k, v] of req.headers) headers[k.toLowerCase()] = v;

		const upstreamPath = url.pathname.startsWith("/probe")
			? `/inference/openai/v1/chat/completions${url.search}`
			: `${url.pathname}${url.search}`;
		const target = `${UPSTREAM}${upstreamPath}`;
		const fwd: Record<string, string> = {};
		for (const [k, v] of Object.entries(headers)) if (!HOP.has(k)) fwd[k] = v;

		let status = 0;
		let respHeaders: Record<string, string> = {};
		let respText = "";
		let err: string | undefined;
		try {
			const res = await fetch(target, {
				method: req.method,
				headers: fwd,
				body: bodyBuf.byteLength > 0 ? bodyBuf : undefined,
			});
			status = res.status;
			for (const [k, v] of res.headers) respHeaders[k.toLowerCase()] = v;
			respText = await res.text();
		} catch (e) {
			err = String(e);
		}

		const rec = {
			id,
			label,
			at: new Date().toISOString(),
			method: req.method,
			path: url.pathname + url.search,
			upstream: target,
			requestHeaders: headers,
			requestBodyRaw: body,
			response: { status, headers: respHeaders, body: respText, error: err },
		};
		await Bun.write(`${dir}/${id}.json`, JSON.stringify(rec, null, 2));
		console.log(`[${label}] ${id} ${req.method} ${url.pathname} -> ${status}`);

		if (err) return new Response(JSON.stringify({ error: err }), { status: 502 });
		return new Response(respText, {
			status,
			headers: { "content-type": respHeaders["content-type"] ?? "application/json" },
		});
	},
});

console.log(`[${label}] listening on ${port} -> ${UPSTREAM}, captures in ${dir}`);

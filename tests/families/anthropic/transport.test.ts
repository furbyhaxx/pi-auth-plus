/** Checks the OAuth wire identity across consecutive turns. */
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FetchFunction } from "@earendil-works/pi-ai";
import { stateDir } from "../../../src/core/paths/index.ts";
import { claudeFetch } from "../../../src/families/anthropic/transport.ts";

test("two OAuth turns share identity and send one unauthenticated preflight without waiting", async () => {
	const root = await mkdtemp(join(tmpdir(), "claude-wire-"));
	try {
		const env = { XDG_STATE_HOME: root, ANTHROPIC_BASE_URL: "https://proxy.example/ignored" };
		const session = "019a2445-634a-7000-8000-000000000001";
		const account = "12345678-1234-1234-1234-123456789abc";
		const sent: { url: string; init: RequestInit }[] = [];
		let rejectHello: (error: Error) => void = () => {};
		const underlying: FetchFunction = Object.assign(
			async (input: string | URL | Request, init?: RequestInit) => {
				sent.push({ url: input instanceof Request ? input.url : String(input), init: init ?? {} });
				if (init?.method === "HEAD") {
					return new Promise<Response>((_resolve, reject) => {
						rejectHello = reject;
					});
				}
				return Response.json({ content: [] });
			},
			{ preconnect: () => {} },
		);
		const makeFetch = () =>
			claudeFetch({
				token: "test-access",
				accountUuid: account,
				sessionId: session,
				env,
				version: async () => "2.1.311",
				rules: [],
				restore: (name) => name,
				underlying,
			});
		for (let i = 0; i < 2; i++) {
			await makeFetch()("https://api.anthropic.com/v1/messages", {
				method: "POST",
				headers: {
					"anthropic-beta": "oauth-2025-04-20,mid-conversation-output-config-2026-07-01",
					"x-auth-plus-account-uuid": account,
					"x-api-key": "test-key",
				},
				body: JSON.stringify({
					messages: [{ role: "user", content: "hello world test message" }],
					metadata: { user_id: "Pi identity", other: "discard" },
				}),
			});
		}
		rejectHello(new Error("preflight unavailable"));
		await Promise.resolve();
		const hello = sent.filter(({ init }) => init.method === "HEAD");
		expect(hello).toHaveLength(1);
		expect(hello[0]?.url).toBe("https://proxy.example/api/hello");
		expect([...new Headers(hello[0]?.init.headers)]).toEqual([]);
		const device = await readFile(join(stateDir(env), "claude-device-id"), "utf8");
		expect(device).toMatch(/^[0-9a-f]{64}$/);
		expect((await stat(join(stateDir(env), "claude-device-id"))).mode & 0o777).toBe(0o600);
		const messages = sent.filter(({ init }) => init.method === "POST");
		expect(messages).toHaveLength(2);
		for (const { url, init } of messages) {
			expect(url).toBe("https://proxy.example/v1/messages?beta=true");
			const headers = new Headers(init.headers);
			expect(headers.get("x-claude-code-session-id")).toBe(session);
			expect(headers.has("x-auth-plus-account-uuid")).toBe(false);
			expect(headers.has("x-api-key")).toBe(false);
			expect(headers.get("user-agent")).toBe("claude-cli/2.1.311 (external, cli)");
			expect(headers.get("x-app")).toBe("cli");
			expect(headers.get("anthropic-beta")).toBe(
				"claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,per-turn-control-2026-07-01,mid-conversation-tool-changes-2026-07-01,inline-tools-2026-09-15,advisor-tool-2026-03-01,thinking-token-count-2026-05-13,advanced-tool-use-2025-11-20,effort-2025-11-24,extended-cache-ttl-2025-04-11,mid-conversation-output-config-2026-07-01",
			);
			const body = JSON.parse(String(init.body));
			expect(body.metadata).toEqual({
				user_id: JSON.stringify({ device_id: device, account_uuid: account, session_id: session }),
			});
			expect(body.system[0].text).toEndWith("cc_entrypoint=cli;");
			expect(body.system[0].text).not.toContain("cch=");
			expect(
				body.system.filter((block: { text: string }) =>
					block.text.startsWith("x-anthropic-billing-header:"),
				),
			).toHaveLength(1);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

/** Independent process fixture so the concurrency test cannot share refresh promises. */
import { appendFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { resolveCodexToken } from "../../../../src/families/openai/codex-auth/index.ts";

const path = process.argv[2];
const now = Number(process.argv[3]);
if (!path || !Number.isFinite(now)) throw new Error("Missing isolated session arguments");
process.once("message", async () => {
	try {
		const token = await resolveCodexToken({
			path,
			now: () => now,
			fetch: async (_input, init) => {
				if (!String(init?.body).includes("refresh_token=test-old-refresh"))
					throw new Error("Unexpected refresh token");
				await appendFile(`${path}.requests`, "refresh\n");
				await delay(2_200);
				return Response.json({
					access_token: "test-new-access",
					refresh_token: "test-new-refresh",
					expires_in: 3600,
				});
			},
		});
		process.send?.({ token });
	} catch {
		process.send?.({ error: "Isolated session failed" });
		process.exitCode = 1;
	} finally {
		process.disconnect?.();
	}
});
process.send?.("ready");

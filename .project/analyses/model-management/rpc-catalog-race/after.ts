import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const emit = (event: string, details: Record<string, unknown> = {}) => {
	appendFileSync(process.env["RACE_TRACE"]!, `${JSON.stringify({ event, at: Date.now(), ...details })}\n`);
};

export default function (pi: any) {
	pi.on("session_start", async (_event: unknown, ctx: any) => {
		emit("after-session", { mode: ctx.mode, trusted: ctx.isProjectTrusted() });
		if (process.env["RACE_RESTART"] === "1" && ctx.mode === "rpc") {
			if (process.env["RACE_BARRIER"] === "1") {
				const pending = (globalThis as any).__racePendingRefreshes as Set<Promise<unknown>>;
				while (pending.size > 0) await Promise.allSettled([...pending]);
				emit("candidate-barrier");
			}
			emit("candidate-restart");
			void ctx.modelRegistry.refresh({ signal: AbortSignal.timeout(15_000) }).then(
				(result: any) => emit("candidate-finished", { aborted: result.aborted, errorCount: result.errors.size }),
				(error: Error) => emit("candidate-error", { message: error.message }),
			);
		}
		setTimeout(() => {
			const models = ctx.modelRegistry.getAll();
			const ids = models.filter((model: any) => model.provider === "synthetic").map((model: any) => model.id);
			const available = ctx.modelRegistry.getAvailable().filter((model: any) => model.provider === "synthetic").map((model: any) => model.id);
			const storePath = join(process.env["PI_CODING_AGENT_DIR"]!, "models-store.json");
			const store = existsSync(storePath) ? readFileSync(storePath, "utf8") : "";
			emit("sample", {
				visible: ids.includes("race-visible"),
				hidden: ids.includes("race-hidden"),
				availableVisible: available.includes("race-visible"),
				storedVisible: store.includes("race-visible"),
				storedHidden: store.includes("race-hidden"),
				openaiCount: models.filter((model: any) => model.provider === "openai").length,
			});
		}, 1800);
	});
}

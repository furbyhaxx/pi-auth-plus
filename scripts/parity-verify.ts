/**
 * Builtin-parity check: in an isolated agent dir with dummy credentials, every provider of ours
 * must appear in `--list-models` and resolve through `--model <provider>/<id>` at startup.
 * Pi binary from PI_BIN (default `pi-bolt`). No network: `--offline` throughout.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Registry } from "../src/core/registry/index.ts";
import { FAMILIES } from "../src/families/index.ts";

const repo = resolve(import.meta.dir, "..");
const entry = join(repo, "src/index.ts");
const piBin = process.env["PI_BIN"] || "pi-bolt";
const TIMEOUT_MS = 30_000;
const BASE_ARGS = ["--offline", "--no-extensions", "-e", entry];
const OAUTH_ONLY = new Set(["antigravity"]);

function listModels(env: NodeJS.ProcessEnv): Map<string, string[]> {
	const run = spawnSync(piBin, [...BASE_ARGS, "--list-models"], {
		env,
		encoding: "utf8",
		timeout: TIMEOUT_MS,
	});
	if (run.status !== 0) {
		throw new Error(`--list-models exited ${run.status}: ${run.stderr || run.stdout}`);
	}
	const byProvider = new Map<string, string[]>();
	// Pi lists only providers with credentials and says so when none has any.
	if (run.stdout.startsWith("No models available")) return byProvider;
	const rows = run.stdout.split("\n").map((line) => line.trim().split(/\s+/));
	if (rows[0]?.[0] !== "provider" || rows[0]?.[1] !== "model") {
		throw new Error(`unexpected --list-models output:\n${run.stdout.slice(0, 500)}`);
	}
	for (const [provider, model] of rows.slice(1)) {
		if (!provider || !model) continue;
		byProvider.set(provider, [...(byProvider.get(provider) ?? []), model]);
	}
	return byProvider;
}

/** Starts Pi in RPC mode with `--model` and returns the model `get_state` reports. */
function resolvedModel(env: NodeJS.ProcessEnv, ref: string): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(piBin, [...BASE_ARGS, "--mode", "rpc", "--no-session", "--model", ref], {
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error(`${ref}: no get_state reply within ${TIMEOUT_MS} ms. ${stderr}`));
		}, TIMEOUT_MS);
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`${ref}: Pi exited ${code} before replying. ${stderr}`));
		});
		createInterface({ input: child.stdout }).on("line", (line) => {
			let message: {
				id?: string;
				success?: boolean;
				data?: { model?: { provider?: string; id?: string } };
			};
			try {
				message = JSON.parse(line);
			} catch {
				return;
			}
			if (message.id !== "state") return;
			clearTimeout(timer);
			child.removeAllListeners("exit");
			child.kill("SIGTERM");
			const model = message.data?.model;
			resolvePromise(message.success && model ? `${model.provider}/${model.id}` : "(none)");
		});
		child.stdin.write(`${JSON.stringify({ type: "get_state", id: "state" })}\n`);
	});
}

async function main(): Promise<number> {
	const registry = new Registry(FAMILIES);
	const providers = registry.providers().map((entry) => entry.provider.id);
	const agentDir = await mkdtemp(join(tmpdir(), "parity-verify-"));
	const failures: string[] = [];
	try {
		// Pi hides OAuth-only providers behind an API-key credential, so those get a dummy login.
		const dummyOAuth = { type: "oauth", access: "dummy", refresh: "dummy", expires: 4e12 };
		const auth = Object.fromEntries(
			providers.map((id) => [
				id,
				OAUTH_ONLY.has(id) ? dummyOAuth : { type: "api_key", key: "dummy" },
			]),
		);
		await writeFile(join(agentDir, "auth.json"), JSON.stringify(auth), { mode: 0o600 });
		const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };

		const listed = listModels(env);
		const total = [...listed.values()].reduce((sum, models) => sum + models.length, 0);
		console.log(`parity-verify: Pi listed ${total} models; checking ${providers.length} providers`);
		for (const id of providers) {
			const first = listed.get(id)?.[0];
			if (!first) {
				failures.push(`${id}: not listed by --list-models`);
				continue;
			}
			const ref = `${id}/${first}`;
			const got = await resolvedModel(env, ref).catch((error: Error) => error.message);
			if (got === ref) console.log(`  ok  ${id}: ${listed.get(id)?.length} models, --model ${ref}`);
			else failures.push(`${id}: --model ${ref} resolved to ${got}`);
		}
	} finally {
		await rm(agentDir, { recursive: true, force: true });
	}
	for (const failure of failures) console.error(`FAIL ${failure}`);
	console.log(
		failures.length === 0 ? "parity-verify: ok" : `parity-verify: ${failures.length} failure(s)`,
	);
	return failures.length === 0 ? 0 : 1;
}

process.exit(await main());

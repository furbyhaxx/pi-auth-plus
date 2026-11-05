/** Owns every filesystem location pi-auth-plus reads or writes, resolved from env and cwd. */
import { homedir } from "node:os";
import { join } from "node:path";

export type PathEnv = Readonly<Record<string, string | undefined>>;

export const SETTINGS_FILE_NAME = "auth-plus.json";
export const APP_DIR_NAME = "pi-auth-plus";

/** Home directory; reads `HOME` first because Bun's `os.homedir()` ignores runtime changes. */
export function homeDir(env: PathEnv = process.env): string {
	return nonEmpty(env["HOME"]) ?? nonEmpty(env["USERPROFILE"]) ?? homedir();
}

/** Pi's agent directory, matching Pi's `getAgentDir()` without a value import from Pi. */
export function agentDir(env: PathEnv = process.env): string {
	const host = pigHost(env).agentDir;
	if (host) return expandTilde(host, env);
	const configured = nonEmpty(env["PI_CODING_AGENT_DIR"]) ?? nonEmpty(env["PIG_CODING_AGENT_DIR"]);
	if (configured) return expandTilde(configured, env);
	const root = nonEmpty(env["PIG_HOME"]);
	if (root) return join(expandTilde(root, env), "agent");
	return join(homeDir(env), ".pi", "agent");
}

/**
 * True when the host reports itself as pig. pig implements no provider refresh seam, so a
 * dynamic catalog has to be refreshed by the extension itself.
 */
export function isPigHost(env: PathEnv = process.env): boolean {
	return nonEmpty(env["PIG_EXT_HOST_INFO"]) !== undefined;
}

/** `--offline`, `PI_OFFLINE` or `PIG_OFFLINE`: no catalog, quota or credit fetch. */
export function offlineRequested(
	env: PathEnv = process.env,
	argv: readonly string[] = process.argv,
): boolean {
	return argv.includes("--offline") || off("PI_OFFLINE", env) || off("PIG_OFFLINE", env);
}

function off(name: string, env: PathEnv): boolean {
	return ["1", "true", "yes"].includes((nonEmpty(env[name]) ?? "").toLowerCase());
}

/**
 * The host's per-project config directory: `.pi` for Pi, `.pig` for pig, which keeps its own tree
 * unless `PIG_USE_PI_DIRS=1` selects Pi's. pig's extension host reports the resolved value.
 */
export function projectConfigDir(env: PathEnv = process.env): string {
	return pigHost(env).configDirName ?? ".pi";
}

/**
 * What pig's extension host reports about this process. Pi has no equivalent variable, so an
 * absent or malformed value means a Pi host.
 */
function pigHost(env: PathEnv): { agentDir?: string; configDirName?: string } {
	const raw = nonEmpty(env["PIG_EXT_HOST_INFO"]);
	if (raw === undefined) return {};
	if (pigHostCache?.raw === raw) return pigHostCache.value;
	const value = parsePigHost(raw);
	pigHostCache = { raw, value };
	return value;
}

let pigHostCache:
	| {
			readonly raw: string;
			readonly value: { agentDir?: string; configDirName?: string };
	  }
	| undefined;

const CONFIG_DIR_RE = /^\.[\w.-]+$/;

function parsePigHost(raw: string): { agentDir?: string; configDirName?: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
	const agent = "agentDir" in parsed ? parsed.agentDir : undefined;
	const configDir = "configDirName" in parsed ? parsed.configDirName : undefined;
	return {
		...(typeof agent === "string" && agent !== "" ? { agentDir: agent } : {}),
		...(typeof configDir === "string" && CONFIG_DIR_RE.test(configDir)
			? { configDirName: configDir }
			: {}),
	};
}

/** Pi's credential store; read through `core/auth` only. */
export function authPath(env: PathEnv = process.env): string {
	return join(agentDir(env), "auth.json");
}

/** Pi's user model and provider overrides (`models.json`). */
export function modelsPath(env: PathEnv = process.env): string {
	return join(agentDir(env), "models.json");
}

export function userSettingsPath(env: PathEnv = process.env): string {
	return join(agentDir(env), SETTINGS_FILE_NAME);
}

/** Project settings; callers pass `ctx.cwd`, never `process.cwd()`. */
export function projectSettingsPath(cwd: string, env: PathEnv = process.env): string {
	return join(cwd, projectConfigDir(env), SETTINGS_FILE_NAME);
}

/** Host cache shared by every session on this machine (quota snapshots and drainage history). */
export function cacheDir(env: PathEnv = process.env): string {
	return join(agentDir(env), "cache", "auth-plus");
}

/** Downloaded artifacts shared across sessions, independent of Pi's agent directory. */
export function xdgCacheDir(env: PathEnv = process.env): string {
	return join(xdgBase(env, "XDG_CACHE_HOME", [".cache"]), APP_DIR_NAME);
}

export function stateDir(env: PathEnv = process.env): string {
	return join(xdgBase(env, "XDG_STATE_HOME", [".local", "state"]), APP_DIR_NAME);
}

export function dataDir(env: PathEnv = process.env): string {
	return join(xdgBase(env, "XDG_DATA_HOME", [".local", "share"]), APP_DIR_NAME);
}

function xdgBase(env: PathEnv, key: string, fallback: readonly string[]): string {
	return nonEmpty(env[key]) ?? join(homeDir(env), ...fallback);
}

function expandTilde(path: string, env: PathEnv): string {
	if (path === "~") return homeDir(env);
	if (path.startsWith("~/")) return join(homeDir(env), path.slice(2));
	return path;
}

function nonEmpty(value: string | undefined): string | undefined {
	return value === undefined || value === "" ? undefined : value;
}

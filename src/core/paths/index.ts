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
	const configured = nonEmpty(env["PI_CODING_AGENT_DIR"]);
	if (configured) return expandTilde(configured, env);
	return join(homeDir(env), ".pi", "agent");
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
export function projectSettingsPath(cwd: string): string {
	return join(cwd, ".pi", SETTINGS_FILE_NAME);
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

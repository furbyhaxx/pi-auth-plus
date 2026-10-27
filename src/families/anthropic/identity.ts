/** Owns lazy Claude device identity and Pi-session UUID selection. */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isErrno } from "../../core/fs/index.ts";
import { type PathEnv, stateDir } from "../../core/paths/index.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE_ID = /^[0-9a-f]{64}$/;
const devices = new Map<string, Promise<string>>();
let fallbackSession: string | undefined;
let fallbackDevice: string | undefined;

/** Keeps valid Pi session UUIDs, with one lazy process UUID for other callers. */
export function sessionId(value: string | undefined): string {
	if (value && UUID.test(value)) return value;
	fallbackSession ??= randomUUID();
	return fallbackSession;
}

async function loadDevice(env: PathEnv, path: string): Promise<string> {
	fallbackDevice ??= randomBytes(32).toString("hex");
	const generated = fallbackDevice;
	try {
		const stored = await readFile(path, "utf8");
		return DEVICE_ID.test(stored) ? stored : generated;
	} catch (error) {
		if (!isErrno(error, "ENOENT")) return generated;
	}
	try {
		await mkdir(stateDir(env), { recursive: true, mode: 0o700 });
		await writeFile(path, generated, { encoding: "utf8", mode: 0o600, flag: "wx" });
		return generated;
	} catch (error) {
		if (!isErrno(error, "EEXIST")) return generated;
		try {
			const stored = await readFile(path, "utf8");
			return DEVICE_ID.test(stored) ? stored : generated;
		} catch {
			return generated;
		}
	}
}

/** Resolves the private persistent device id once per state directory, tolerating disk failures. */
export function deviceId(env: PathEnv): Promise<string> {
	const path = join(stateDir(env), "claude-device-id");
	let pending = devices.get(path);
	if (!pending) {
		pending = loadDevice(env, path);
		devices.set(path, pending);
	}
	return pending;
}

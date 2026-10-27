/**
 * The Claude Code version claude reports in its user agent and billing block. Anthropic gates
 * newer models on it (400 `claude_code_version_too_old`), so the newest trustworthy one wins.
 */
import { execFile } from "node:child_process";
import type { PathEnv } from "../../core/paths/index.ts";

/** Pinned release; tracked in `.project/analyses/claude-code-cli/tracking.md`. */
export const PINNED_VERSION = "2.1.306";
export const VERSION_ENV = "ANTHROPIC_CLAUDE_CODE_VERSION";

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const VERSION_IN_OUTPUT_RE = /(\d+\.\d+\.\d+)/;
const DETECT_TIMEOUT_MS = 2_000;

export type VersionOverride =
	| { readonly kind: "unset" }
	| { readonly kind: "valid"; readonly version: string }
	| { readonly kind: "outdated"; readonly version: string; readonly warning: string }
	| { readonly kind: "invalid"; readonly warning: string };

/** Runs `claude --version` and returns its stdout, or undefined when it is missing or fails. */
export type VersionProbe = () => Promise<string | undefined>;

export function userAgent(version: string): string {
	return `claude-cli/${version} (external, cli)`;
}

/** Numeric comparison; `2.1.99` is older than `2.1.306` although it sorts after it as text. */
export function isOlder(candidate: string, baseline: string): boolean {
	const a = candidate.split(".").map(BigInt);
	const b = baseline.split(".").map(BigInt);
	for (let index = 0; index < 3; index += 1) {
		const left = a[index] ?? 0n;
		const right = b[index] ?? 0n;
		if (left !== right) return left < right;
	}
	return false;
}

/** Reads the env override. An older override is honored with a warning, a malformed one ignored. */
export function readOverride(env: PathEnv): VersionOverride {
	const raw = env[VERSION_ENV];
	if (raw === undefined) return { kind: "unset" };
	const version = raw.trim();
	if (!VERSION_RE.test(version)) {
		return {
			kind: "invalid",
			warning: `claude: ${VERSION_ENV}=${JSON.stringify(raw)} is not a major.minor.patch version; reporting ${PINNED_VERSION} instead. Fix or unset it and /reload.`,
		};
	}
	if (isOlder(version, PINNED_VERSION)) {
		return {
			kind: "outdated",
			version,
			warning: `claude: ${VERSION_ENV}=${version} is older than the pinned ${PINNED_VERSION}; newer models may refuse it. Raise or unset it and /reload.`,
		};
	}
	return { kind: "valid", version };
}

/** The installed release, when it parses and is not older than the pin. */
export function pickDetected(output: string | undefined): string {
	const detected = output?.match(VERSION_IN_OUTPUT_RE)?.[1];
	if (!detected || isOlder(detected, PINNED_VERSION)) return PINNED_VERSION;
	return detected;
}

export const probeInstalledClaude: VersionProbe = () =>
	new Promise((resolve) => {
		execFile(
			"claude",
			["--version"],
			{ timeout: DETECT_TIMEOUT_MS, windowsHide: true, encoding: "utf8" },
			(error, stdout) => resolve(error ? undefined : stdout),
		);
	});

/**
 * Resolves the reported version once, lazily: env override > installed `claude` (if not older)
 * > pin. The probe spawns a process, so it runs on first use, never in the factory.
 */
export class ReportedVersion {
	readonly override: VersionOverride;
	readonly #probe: VersionProbe;
	#pending: Promise<string> | undefined;

	constructor(env: PathEnv = process.env, probe: VersionProbe = probeInstalledClaude) {
		this.override = readOverride(env);
		this.#probe = probe;
	}

	get(): Promise<string> {
		this.#pending ??= this.#resolve();
		return this.#pending;
	}

	async #resolve(): Promise<string> {
		const override = this.override;
		if (override.kind === "valid" || override.kind === "outdated") return override.version;
		if (override.kind === "invalid") return PINNED_VERSION;
		return pickDetected(await this.#probe());
	}
}

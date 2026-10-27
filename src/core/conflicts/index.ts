/** Detects packages pi-auth-plus absorbs, so a user running both is told once which to remove. */

/** Repository or npm names of the packages whose features pi-auth-plus now provides. */
export const ABSORBED_PACKAGES = [
	"pi-claude-auth",
	"pi-opencode-auth",
	"pi-synthetic-auth",
	"pi-antigravity-auth",
	"pi-quotas",
] as const;

export type AbsorbedPackage = (typeof ABSORBED_PACKAGES)[number];

/** A Pi `packages` entry: a source string, or an object that may filter its extensions. */
export type PackageEntry =
	| string
	| { readonly source: string; readonly extensions?: readonly string[] };

export interface Conflict {
	readonly name: AbsorbedPackage;
	/** The settings source or file path that loads it. */
	readonly source: string;
	/** `package`: a Pi packages entry, removable with `pi remove`; `path`: a direct extension load. */
	readonly via: "package" | "path";
}

const SEGMENT_SPLIT_RE = /[/\\:]/;
const REF_SUFFIX_RE = /(?:\.git)?(?:@[^@/\\]*)?$/;

/** The absorbed package a source string or file path names, if any. */
export function absorbedName(source: string): AbsorbedPackage | undefined {
	const segments = source
		.split(SEGMENT_SPLIT_RE)
		.map((segment) => segment.replace(REF_SUFFIX_RE, ""));
	return ABSORBED_PACKAGES.find((name) => segments.includes(name));
}

function loadsExtensions(entry: PackageEntry): boolean {
	if (typeof entry === "string") return true;
	return entry.extensions === undefined || entry.extensions.some((path) => !path.startsWith("-"));
}

/**
 * Absorbed packages that Pi loads: package and extension entries from the effective settings,
 * plus the source paths of registered commands (covers `-e` loads). One conflict per package.
 */
export function detectConflicts(
	packages: readonly PackageEntry[],
	extensions: readonly string[],
	commandPaths: readonly string[],
): Conflict[] {
	const found = new Map<AbsorbedPackage, Conflict>();
	const consider = (source: string, via: Conflict["via"]) => {
		const name = absorbedName(source);
		if (name && !found.has(name)) found.set(name, { name, source, via });
	};
	for (const entry of packages) {
		if (loadsExtensions(entry))
			consider(typeof entry === "string" ? entry : entry.source, "package");
	}
	for (const path of extensions) if (!path.startsWith("-")) consider(path, "path");
	for (const path of commandPaths) consider(path, "path");
	return [...found.values()];
}

export function conflictMessage(conflicts: readonly Conflict[]): string {
	const names = conflicts.map((conflict) => conflict.name).join(", ");
	const removals = conflicts
		.map((conflict) =>
			conflict.via === "package"
				? `pi remove ${conflict.source}`
				: `stop loading ${conflict.source}`,
		)
		.join("; ");
	return `pi-auth-plus replaces ${names}. Running both duplicates providers and commands. Remove: ${removals}`;
}

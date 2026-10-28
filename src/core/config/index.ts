/** Owns layered settings: defaults < user < project (trusted only) < runtime, one catalog. */
import { atomicWriteFile, readJsonFile } from "../fs/index.ts";
import type { Field, FieldValue } from "./fields.ts";

export * from "./fields.ts";

export type Scope = "default" | "user" | "project" | "runtime";
export type SaveScope = Exclude<Scope, "default">;

/** Dotted keys (`quotas.refreshIntervalSec`) map to nested objects in `auth-plus.json`. */
export type Catalog = Readonly<Record<string, Field<FieldValue>>>;
export type ValueOf<C extends Catalog, K extends keyof C> = C[K] extends Field<infer T> ? T : never;
export type Values<C extends Catalog> = { readonly [K in keyof C]: ValueOf<C, K> };
export type Layer<C extends Catalog> = { [K in keyof C]?: ValueOf<C, K> };
/** Staged edits; `null` removes the key from the scope so the value inherits again. */
export type Changes<C extends Catalog> = { [K in keyof C]?: ValueOf<C, K> | null };

export interface SettingsResolutionOptions {
	/** Exclude the trusted project layer without excluding runtime changes. */
	readonly includeProject?: boolean;
}

export interface SettingsPaths {
	readonly user: string;
	/** Omitted when the project is not trusted; its file is then never read or written. */
	readonly project?: string;
}

export interface SettingsProblem {
	readonly path: string;
	readonly key?: string;
	readonly reason: string;
}

export class SettingsError extends Error {
	override readonly name = "SettingsError";
	readonly path: string;

	constructor(path: string, message: string) {
		super(message);
		this.path = path;
	}
}

type JsonObject = Record<string, unknown>;

export class SettingsStore<C extends Catalog> {
	private readonly catalog: C;
	private readonly paths: SettingsPaths;
	private readonly layers: Record<SaveScope, Layer<C>> = { user: {}, project: {}, runtime: {} };

	constructor(catalog: C, paths: SettingsPaths) {
		this.catalog = catalog;
		this.paths = paths;
	}

	/** Reload both files. Invalid fields are skipped and reported; a malformed file empties its layer. */
	async load(): Promise<readonly SettingsProblem[]> {
		const problems: SettingsProblem[] = [];
		for (const scope of ["user", "project"] as const) {
			const path = this.paths[scope];
			this.layers[scope] = {};
			if (path === undefined) continue;
			const read = await readJsonFile(path);
			if (read.kind === "missing") continue;
			if (read.kind === "malformed" || !isObject(read.value)) {
				problems.push({
					path,
					reason: read.kind === "malformed" ? read.reason : "not a JSON object",
				});
				continue;
			}
			this.layers[scope] = this.parseLayer(read.value, path, problems);
		}
		return problems;
	}

	get<K extends keyof C & string>(key: K, options?: SettingsResolutionOptions): ValueOf<C, K> {
		for (const scope of ["runtime", "project", "user"] as const) {
			if (scope === "project" && options?.includeProject === false) continue;
			const value = this.layers[scope][key];
			if (value !== undefined) return value;
		}
		return this.field(key).default as ValueOf<C, K>;
	}

	values(): Values<C> {
		const out: Record<string, FieldValue> = {};
		for (const key of this.keys()) out[key] = this.get(key);
		return out as Values<C>;
	}

	sourceOf(key: keyof C & string, options?: SettingsResolutionOptions): Scope {
		for (const scope of ["runtime", "project", "user"] as const) {
			if (scope === "project" && options?.includeProject === false) continue;
			if (this.layers[scope][key] !== undefined) return scope;
		}
		return "default";
	}

	/** Keys among `keys` that a higher scope overrides, so saving to `scope` has no visible effect. */
	shadowed(scope: SaveScope, keys: readonly (keyof C & string)[]): (keyof C & string)[] {
		const above: SaveScope[] =
			scope === "user" ? ["project", "runtime"] : scope === "project" ? ["runtime"] : [];
		return keys.filter((key) => above.some((s) => this.layers[s][key] !== undefined));
	}

	/**
	 * Apply staged changes to one scope. File scopes re-read the file first, preserve unknown
	 * keys, and refuse to overwrite a malformed file.
	 */
	async save(scope: SaveScope, changes: Changes<C>): Promise<void> {
		const entries = this.validate(changes, scope);
		if (scope === "runtime") {
			this.layers.runtime = applyToLayer(this.layers.runtime, entries);
			return;
		}
		const path = this.paths[scope];
		if (path === undefined) {
			throw new SettingsError("", "Project settings are unavailable until the project is trusted");
		}
		const read = await readJsonFile(path);
		if (read.kind === "malformed" || (read.kind === "ok" && !isObject(read.value))) {
			throw new SettingsError(
				path,
				`Cannot save ${path}: the file is not valid JSON; fix it and retry`,
			);
		}
		const doc = read.kind === "ok" ? structuredClone(read.value as JsonObject) : {};
		for (const [key, value] of entries) {
			if (value === null) deletePath(doc, key.split("."));
			else setPath(doc, key.split("."), value);
		}
		await atomicWriteFile(path, `${JSON.stringify(doc, null, "\t")}\n`);
		this.layers[scope] = this.parseLayer(doc, path, []);
	}

	private keys(): (keyof C & string)[] {
		return Object.keys(this.catalog) as (keyof C & string)[];
	}

	private field(key: string): Field<FieldValue> {
		const field = this.catalog[key];
		if (field === undefined) throw new SettingsError("", `Unknown setting "${key}"`);
		return field;
	}

	private parseLayer(doc: JsonObject, path: string, problems: SettingsProblem[]): Layer<C> {
		const layer: Record<string, FieldValue> = {};
		for (const key of this.keys()) {
			const raw = getPath(doc, key.split("."));
			if (raw === undefined) continue;
			const value = this.field(key).parse(raw);
			if (value === undefined) {
				problems.push({
					path,
					key,
					reason: `invalid value ${JSON.stringify(raw)}; using inherited`,
				});
				continue;
			}
			layer[key] = value;
		}
		return layer as Layer<C>;
	}

	private validate(changes: Changes<C>, scope: SaveScope): [string, FieldValue | null][] {
		const out: [string, FieldValue | null][] = [];
		for (const [key, value] of Object.entries(changes)) {
			if (value === undefined) continue;
			if (value === null) {
				out.push([key, null]);
				continue;
			}
			const parsed = this.field(key).parse(value);
			if (parsed === undefined) {
				throw new SettingsError(
					"",
					`Invalid ${scope} value for "${key}": ${JSON.stringify(value)}`,
				);
			}
			out.push([key, parsed]);
		}
		return out;
	}
}

function applyToLayer<C extends Catalog>(
	layer: Layer<C>,
	entries: readonly [string, FieldValue | null][],
): Layer<C> {
	const next: Record<string, FieldValue> = { ...(layer as Record<string, FieldValue>) };
	for (const [key, value] of entries) {
		if (value === null) delete next[key];
		else next[key] = value;
	}
	return next as Layer<C>;
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPath(doc: JsonObject, parts: readonly string[]): unknown {
	let node: unknown = doc;
	for (const part of parts) {
		if (!isObject(node)) return undefined;
		node = node[part];
	}
	return node;
}

function setPath(doc: JsonObject, parts: readonly string[], value: FieldValue): void {
	let node = doc;
	for (const part of parts.slice(0, -1)) {
		const child = node[part];
		if (!isObject(child)) node[part] = {};
		node = node[part] as JsonObject;
	}
	const last = parts.at(-1);
	if (last !== undefined) node[last] = value;
}

/** Remove a leaf and prune parents this removal left empty. */
function deletePath(doc: JsonObject, parts: readonly string[]): void {
	const [head, ...rest] = parts;
	if (head === undefined) return;
	if (rest.length === 0) {
		delete doc[head];
		return;
	}
	const child = doc[head];
	if (!isObject(child)) return;
	deletePath(child, rest);
	if (Object.keys(child).length === 0) delete doc[head];
}

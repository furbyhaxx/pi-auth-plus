/** Round-trip storage for individual Pi model override fields. */
import { randomBytes } from "node:crypto";
import {
	closeSync,
	fchmodSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { type Node, parseJsonc } from "./jsonc.ts";

/** A JSON-compatible value. */
export type JsonValue =
	| null
	| boolean
	| number
	| string
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };
/** A field operation; null is a value, never a deletion. */
export type OverrideEdit =
	| { readonly kind: "set"; readonly value: JsonValue }
	| { readonly kind: "remove" };
/** A staged edit to one nested override field. */
export interface OverrideChange {
	readonly field: readonly string[];
	readonly edit: OverrideEdit;
}

type Snapshot =
	| { readonly text: string; readonly mode: number; readonly identity: string }
	| undefined;
function missing(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function snapshot(path: string): Snapshot {
	try {
		const info = lstatSync(path, { bigint: true });
		if (!info.isFile())
			throw new Error("models.json must be a regular file; resolve the path before editing");
		const bytes = readFileSync(path);
		const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
		return {
			text,
			mode: Number(info.mode & 0o777n),
			identity: `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`,
		};
	} catch (error) {
		if (missing(error)) return undefined;
		throw error;
	}
}
function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function getChild(value: unknown, key: string): unknown {
	if (!object(value))
		throw new Error(
			"models.json contains a non-object on the override path; correct it before editing",
		);
	return Object.hasOwn(value, key) ? value[key] : undefined;
}
function parsed(text: string): { root: Node; value: unknown } {
	const doc = parseJsonc(text);
	if (!object(doc.value))
		throw new Error("models.json root must be an object; correct it before editing");
	return doc;
}
/** Read an override, or undefined if it does not exist. */
export async function readOverride(
	path: string,
	providerId: string,
	modelId: string,
): Promise<Record<string, unknown> | undefined> {
	const source = snapshot(resolve(path));
	if (!source) return undefined;
	let value: unknown = parsed(source.text).value;
	for (const key of ["providers", providerId, "modelOverrides", modelId]) {
		value = getChild(value, key);
		if (value === undefined) return undefined;
	}
	if (!object(value))
		throw new Error("models.json override must be an object; correct it before editing");
	return value;
}
function encode(value: JsonValue): string {
	const active = new Set<object>();
	function check(item: unknown): void {
		if (item === null || typeof item === "string" || typeof item === "boolean") return;
		if (typeof item === "number" && Number.isFinite(item)) return;
		if (typeof item !== "object" || active.has(item))
			throw new Error("Override value must be JSON-compatible");
		if (
			!Array.isArray(item) &&
			Object.getPrototypeOf(item) !== Object.prototype &&
			Object.getPrototypeOf(item) !== null
		)
			throw new Error("Override value must be JSON-compatible");
		active.add(item);
		if (Array.isArray(item)) {
			for (let i = 0; i < item.length; i++) check(item[i]);
		} else {
			for (const child of Object.values(item)) check(child);
		}
		active.delete(item);
	}
	check(value);
	return JSON.stringify(value);
}
function changed(text: string, keys: readonly string[], edit: OverrideEdit): string {
	const doc = parsed(text);
	let current = doc.root;
	let value = doc.value;
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		if (key === undefined || current.members === undefined || !object(value))
			throw new Error(
				"models.json contains a non-object on the override path; correct it before editing",
			);
		const index = current.members.findIndex((member) => member.key === key);
		const member = current.members[index];
		const last = i === keys.length - 1;
		if (!member) {
			if (edit.kind === "remove") return text;
			let insertion = encode(edit.value);
			for (let j = keys.length - 1; j > i; j--)
				insertion = `{${JSON.stringify(keys[j])}:${insertion}}`;
			const prior = current.members.at(-1);
			const comma = prior && prior.comma === undefined ? "," : "";
			const at = current.end - 1;
			const property = `\n${JSON.stringify(key)}: ${insertion}\n`;
			if (!comma || !prior) return text.slice(0, at) + property + text.slice(at);
			return (
				text.slice(0, prior.value.end) +
				comma +
				text.slice(prior.value.end, at) +
				property +
				text.slice(at)
			);
		}
		if (last) {
			if (edit.kind === "set")
				return (
					text.slice(0, member.value.start) + encode(edit.value) + text.slice(member.value.end)
				);
			if (member.comma !== undefined)
				return (
					text.slice(0, member.start) +
					text.slice(member.value.end, member.comma) +
					text.slice(member.comma + 1)
				);
			const previous = current.members[index - 1];
			if (previous?.comma !== undefined)
				return (
					text.slice(0, previous.comma) +
					text.slice(previous.comma + 1, member.start) +
					text.slice(member.value.end)
				);
			return text.slice(0, member.start) + text.slice(member.value.end);
		}
		value = getChild(value, key);
		current = member.value;
	}
	return text;
}
/** Set or remove a nested override field. Holds a lock and refuses conflicting or malformed input. */
export async function updateOverride(
	path: string,
	providerId: string,
	modelId: string,
	field: readonly string[],
	edit: OverrideEdit,
): Promise<void> {
	await updateOverrides(path, providerId, modelId, [{ field, edit }]);
}

/** Atomically apply all staged edits to one model override. */
export async function updateOverrides(
	path: string,
	providerId: string,
	modelId: string,
	changes: readonly OverrideChange[],
): Promise<void> {
	if (changes.length === 0) return;
	if (changes.some(({ field }) => field.length === 0 || field.some((key) => key.length === 0)))
		throw new Error("An override field path is required");
	const target = resolve(path);
	const dir = dirname(target);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	let compromised = false;
	const release = await lockfile.lock(target, {
		realpath: false,
		stale: 30_000,
		retries: { retries: 20, minTimeout: 20, maxTimeout: 50 },
		onCompromised: () => {
			compromised = true;
		},
	});
	try {
		const before = snapshot(target);
		const source = before?.text ?? '{"providers":{}}\n';
		let result = source;
		for (const { field, edit } of changes)
			result = changed(
				result,
				["providers", providerId, "modelOverrides", modelId, ...field],
				edit,
			);
		if (result === source) return;
		parsed(result);
		const temp = join(dir, `.${basename(target)}.${randomBytes(16).toString("hex")}.tmp`);
		let created = false;
		try {
			const fd = openSync(temp, "wx", before?.mode ?? 0o600);
			created = true;
			try {
				fchmodSync(fd, before?.mode ?? 0o600);
				writeFileSync(fd, result, "utf8");
				fsyncSync(fd);
			} finally {
				closeSync(fd);
			}
			const now = snapshot(target);
			if (compromised || before?.identity !== now?.identity || before?.text !== now?.text)
				throw new Error("models.json changed during the edit; reload and retry");
			renameSync(temp, target);
			created = false;
			const dirFd = openSync(dir, "r");
			try {
				fsyncSync(dirFd);
			} finally {
				closeSync(dirFd);
			}
		} finally {
			if (created) unlinkSync(temp);
		}
	} finally {
		await release();
	}
}

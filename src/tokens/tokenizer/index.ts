/** Downloads verified, revision-pinned tokenizers and owns their offline disk cache. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { withFileLock } from "../../core/cache/lock.ts";
import { atomicWriteFile, readJsonFile } from "../../core/fs/index.ts";
import { type FetchFn, request } from "../../core/http/index.ts";
import { xdgCacheDir } from "../../core/paths/index.ts";
import type { TextTokenizer, TokenizerStore } from "../types.ts";

/** Overrides for transport, artifact storage and download limits. */
export interface TokenizerStoreOptions {
	/** Cache root; artifacts live in its tokenizers subdirectory. */
	readonly dir: string;
	/** Defaults to the runtime's fetch. */
	readonly fetch?: FetchFn;
	/** Maximum bytes for each file, default 64 MiB. */
	readonly maxFileBytes?: number;
	/** How long a failed load is remembered before a later call retries, default 10 minutes. */
	readonly retryAfterMs?: number;
	readonly now?: () => number;
}

type FileName = "tokenizer.json" | "tokenizer_config.json";
interface FileInfo {
	readonly size: number;
	readonly sha256: string;
}
interface Entry {
	readonly revision: string;
	readonly fetchedAt: number;
	readonly files: Partial<Record<FileName, FileInfo>>;
}
interface RemoteFile {
	readonly name: FileName;
	readonly size: number;
	readonly hash: string;
	readonly lfs: boolean;
}
const FILES: readonly FileName[] = ["tokenizer.json", "tokenizer_config.json"];
const PRIVATE = { mode: 0o600, dirMode: 0o700 };
const SHA = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
// Covers the body stream too: a 28 MB tokenizer must not fail on a slow link.
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const REPO = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** Creates a network-free store; each repo is loaded at most once in this process. */
export function createTokenizerStore(options: TokenizerStoreOptions): TokenizerStore {
	const root = join(options.dir, "tokenizers");
	const indexPath = join(root, "index.json");
	const maxBytes = options.maxFileBytes ?? 64 * 1024 * 1024;
	const loaded = new Map<string, TextTokenizer>();
	const loads = new Map<string, Promise<TextTokenizer | undefined>>();
	const failedAt = new Map<string, number>();
	const now = options.now ?? Date.now;
	const retryAfterMs = options.retryAfterMs ?? 10 * 60_000;
	const get = (url: string, init: RequestInit & { timeoutMs?: number } = {}) =>
		request(url, {
			...init,
			provider: "huggingface",
			...(options.fetch ? { fetch: options.fetch } : {}),
		});

	async function load(repo: string): Promise<TextTokenizer | undefined> {
		if (!REPO.test(repo)) return undefined;
		const index = await readIndex(indexPath);
		const cached = index.get(repo);
		if (cached) {
			const contents = await readCached(root, repo, cached, maxBytes);
			// A missing or corrupted cache file falls through to a fresh, verified download.
			if (contents) return instantiate(repo, cached.revision, contents);
		}
		const api = `https://huggingface.co/api/models/${repo}`;
		const revisionData: unknown = await (await get(`${api}/revision/main`)).json();
		if (
			!record(revisionData) ||
			typeof revisionData["sha"] !== "string" ||
			!SHA.test(revisionData["sha"])
		)
			return undefined;
		const revision = revisionData["sha"];
		const metadata: unknown = await (
			await get(`${api}/paths-info/${revision}`, {
				method: "POST",
				body: new URLSearchParams([
					["paths", "tokenizer.json"],
					["paths", "tokenizer_config.json"],
					["expand", "true"],
				]),
			})
		).json();
		const files = remoteFiles(metadata, maxBytes);
		if (!files) return undefined;
		const contents: Partial<Record<FileName, string>> = {};
		const infos: Partial<Record<FileName, FileInfo>> = {};
		for (const file of files) {
			const response = await get(
				`https://huggingface.co/${repo}/resolve/${revision}/${file.name}`,
				{
					timeoutMs: DOWNLOAD_TIMEOUT_MS,
				},
			);
			const bytes = await boundedBytes(response, file.size);
			if (!bytes) return undefined;
			const sha256 = digest(bytes);
			const hash = file.lfs
				? sha256
				: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
			if (hash !== file.hash) return undefined;
			contents[file.name] = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
				bytes,
			);
			infos[file.name] = { size: bytes.length, sha256 };
		}
		const tokenizer = await instantiate(repo, revision, contents);
		if (!tokenizer) return undefined;
		for (const file of files) {
			const text = contents[file.name];
			if (text !== undefined)
				await atomicWriteFile(
					join(root, encodeURIComponent(repo), revision, file.name),
					text,
					PRIVATE,
				);
		}
		await withFileLock(
			indexPath,
			async () => {
				const latest = await readIndex(indexPath);
				latest.set(repo, { revision, files: infos, fetchedAt: now() });
				await atomicWriteFile(indexPath, JSON.stringify(Object.fromEntries(latest)), PRIVATE);
			},
			{ waitMs: Infinity, staleMs: 60_000, dirMode: 0o700 },
		);
		return tokenizer;
	}
	return {
		peek: (repo) => loaded.get(repo),
		load(repo) {
			const pending = loads.get(repo);
			const failed = failedAt.get(repo);
			if (pending && (failed === undefined || now() - failed < retryAfterMs)) return pending;
			failedAt.delete(repo);
			const promise = load(repo)
				.catch(() => undefined)
				.then((tokenizer) => {
					if (tokenizer) loaded.set(repo, tokenizer);
					// Failures are remembered for a while so an unavailable repo is not retried every turn.
					else failedAt.set(repo, now());
					return tokenizer;
				});
			loads.set(repo, promise);
			return promise;
		},
	};
}

let defaultStore: TokenizerStore | undefined;
/** Lazily creates the shared store using XDG cache storage and the runtime transport. */
export function defaultTokenizerStore(): TokenizerStore {
	defaultStore ??= createTokenizerStore({ dir: xdgCacheDir() });
	return defaultStore;
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function digest(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}
function size(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
async function readCached(
	root: string,
	repo: string,
	entry: Entry,
	maxBytes: number,
): Promise<Partial<Record<FileName, string>> | undefined> {
	const contents: Partial<Record<FileName, string>> = {};
	for (const name of FILES) {
		const info = entry.files[name];
		if (!info) continue;
		if (info.size > maxBytes) return undefined;
		const bytes = await readFile(join(root, encodeURIComponent(repo), entry.revision, name)).catch(
			() => undefined,
		);
		if (!bytes || bytes.length !== info.size || digest(bytes) !== info.sha256) return undefined;
		contents[name] = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
	}
	return contents;
}
async function readIndex(path: string): Promise<Map<string, Entry>> {
	const read = await readJsonFile(path);
	const entries = new Map<string, Entry>();
	if (read.kind !== "ok" || !record(read.value)) return entries;
	for (const [repo, entry] of Object.entries(read.value)) {
		if (
			!REPO.test(repo) ||
			!record(entry) ||
			typeof entry["revision"] !== "string" ||
			!SHA.test(entry["revision"]) ||
			!size(entry["fetchedAt"]) ||
			!record(entry["files"])
		)
			continue;
		const files: Partial<Record<FileName, FileInfo>> = {};
		for (const name of FILES) {
			const info = entry["files"][name];
			if (
				record(info) &&
				size(info["size"]) &&
				typeof info["sha256"] === "string" &&
				SHA256.test(info["sha256"])
			)
				files[name] = { size: info["size"], sha256: info["sha256"].toLowerCase() };
		}
		if (files["tokenizer.json"])
			entries.set(repo, { revision: entry["revision"], fetchedAt: entry["fetchedAt"], files });
	}
	return entries;
}
function remoteFiles(value: unknown, maxBytes: number): RemoteFile[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const result: RemoteFile[] = [];
	for (const name of FILES) {
		const row: unknown = value.find((item: unknown) => record(item) && item["path"] === name);
		if (row === undefined && name === "tokenizer_config.json") continue;
		if (!record(row) || !size(row["size"]) || row["size"] > maxBytes) return undefined;
		const lfs = row["lfs"] !== undefined && row["lfs"] !== null;
		const hash = lfs && record(row["lfs"]) ? row["lfs"]["oid"] : row["oid"];
		if (typeof hash !== "string" || !(lfs ? SHA256 : SHA).test(hash)) return undefined;
		result.push({ name, size: row["size"], hash: hash.toLowerCase(), lfs });
	}
	return result;
}
async function boundedBytes(response: Response, expected: number): Promise<Buffer | undefined> {
	if (!response.body) return undefined;
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			length += chunk.value.length;
			if (length > expected) {
				await reader.cancel();
				return undefined;
			}
			chunks.push(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	return length === expected ? Buffer.concat(chunks, length) : undefined;
}
async function instantiate(
	repo: string,
	revision: string,
	contents: Partial<Record<FileName, string>>,
): Promise<TextTokenizer | undefined> {
	const text = contents["tokenizer.json"];
	if (text === undefined) return undefined;
	const json: unknown = JSON.parse(text);
	const config: unknown = JSON.parse(contents["tokenizer_config.json"] ?? "{}");
	if (!record(json) || !record(config)) return undefined;
	const { Tokenizer } = await import("@huggingface/tokenizers");
	const tokenizer = new Tokenizer(json, config);
	const memo = new Map<string, number>();
	return {
		id: `${repo}@${revision.slice(0, 7)}`,
		count(text) {
			const key = Buffer.byteLength(text) >= 1024 ? digest(Buffer.from(text)) : undefined;
			if (key !== undefined) {
				const cached = memo.get(key);
				if (cached !== undefined) {
					memo.delete(key);
					memo.set(key, cached);
					return cached;
				}
			}
			const count = tokenizer.encode(text, { add_special_tokens: false }).ids.length;
			if (key !== undefined) {
				memo.set(key, count);
				if (memo.size > 4096) {
					const oldest = memo.keys().next().value;
					if (oldest !== undefined) memo.delete(oldest);
				}
			}
			return count;
		},
	};
}

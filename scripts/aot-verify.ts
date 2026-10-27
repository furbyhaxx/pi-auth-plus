/**
 * Checks the Pi-Bolt AOT rules (Pi-Bolt docs/PLUGINS.md) for every module under the given roots
 * (default `src`): literal imports only, no value import from pi-coding-agent, no reads beside
 * the source, a per-module bytecode budget, and a clean bundle of `src/index.ts` with Pi external.
 */
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

// Measured as the whole module's .jsc size: an upper bound for its top-level code and any function.
const BYTECODE_LIMIT = 256 * 1024;
const BYTECODE_WARN = 128 * 1024;
const PI_EXTERNALS = [
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-tui",
	"typebox",
];
const VALUE_FORBIDDEN = "@earendil-works/pi-coding-agent";
const CALL_RE = /\b(import|require)\s*\(\s*/g;
const LITERAL_ARG_RE = /^(?:"[^"\\\n]*"|'[^'\\\n]*'|`[^`$\\]*`)\s*[,)]/;
const BESIDE_SOURCE_RE =
	/\bimport\.meta\.(?:dir|dirname|filename|path|file|url)\b|\b__dirname\b|\b__filename\b/;

interface Finding {
	file: string;
	rule: string;
	detail: string;
}

const transpiler = new Bun.Transpiler({ loader: "ts" });
const repo = resolve(import.meta.dir, "..");

async function listModules(dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await listModules(path)));
		else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(path);
	}
	return out;
}

function sourceFindings(file: string, code: string): Finding[] {
	const findings: Finding[] = [];
	const js = transpiler.transformSync(code);
	for (const imp of transpiler.scanImports(code)) {
		if (imp.path === VALUE_FORBIDDEN && imp.kind !== "dynamic-import") {
			findings.push({ file, rule: "type-only-pi", detail: `value import from ${imp.path}` });
		}
	}
	for (const match of js.matchAll(CALL_RE)) {
		const rest = js.slice((match.index ?? 0) + match[0].length);
		if (!LITERAL_ARG_RE.test(rest)) {
			findings.push({
				file,
				rule: "literal-imports",
				detail: `${match[1]}(${rest.slice(0, 40).split("\n")[0]}...`,
			});
		}
	}
	const beside = BESIDE_SOURCE_RE.exec(js);
	if (beside) {
		findings.push({
			file,
			rule: "embed-files",
			detail: `${beside[0]} (embed with \`with { type }\`)`,
		});
	}
	return findings;
}

async function bytecodeSize(file: string, outdir: string): Promise<number> {
	const result = await Bun.build({
		entrypoints: [file],
		outdir,
		target: "bun",
		format: "cjs",
		bytecode: true,
		plugins: [
			{
				name: "single-module",
				setup(build) {
					build.onResolve({ filter: /.*/ }, (args) =>
						args.importer ? { path: args.path, external: true } : undefined,
					);
				},
			},
		],
	});
	if (!result.success) throw new AggregateError(result.logs, `bytecode build failed: ${file}`);
	const jsc = result.outputs.find((o) => o.path.endsWith(".jsc"));
	if (!jsc) throw new Error(`no bytecode output for ${file}`);
	return (await stat(jsc.path)).size;
}

async function bundleEntry(outdir: string): Promise<Finding[]> {
	const entry = join(repo, "src/index.ts");
	const result = await Bun.build({
		entrypoints: [entry],
		outdir,
		target: "bun",
		format: "esm",
		splitting: true,
		external: PI_EXTERNALS,
	});
	if (!result.success) {
		return result.logs.map((log) => ({
			file: "src/index.ts",
			rule: "bundle",
			detail: String(log),
		}));
	}
	const findings: Finding[] = [];
	for (const output of result.outputs) {
		const code = await readFile(output.path, "utf8");
		if (new RegExp(`from\\s*["']${VALUE_FORBIDDEN}["']`).test(code)) {
			findings.push({
				file: relative(outdir, output.path),
				rule: "type-only-pi",
				detail: "bundle keeps a value import",
			});
		}
	}
	return findings;
}

async function main(): Promise<number> {
	const roots = process.argv.slice(2);
	const dirs = (roots.length > 0 ? roots : ["src"]).map((r) => resolve(repo, r));
	const work = await mkdtemp(join(tmpdir(), "aot-verify-"));
	const findings: Finding[] = [];
	const sizes: [string, number][] = [];
	try {
		for (const dir of dirs) {
			for (const file of await listModules(dir)) {
				const rel = relative(repo, file);
				findings.push(...sourceFindings(rel, await readFile(file, "utf8")));
				const size = await bytecodeSize(file, join(work, String(sizes.length)));
				sizes.push([rel, size]);
				if (size > BYTECODE_LIMIT) {
					findings.push({
						file: rel,
						rule: "bytecode-budget",
						detail: `${size} B > ${BYTECODE_LIMIT} B`,
					});
				}
			}
		}
		if (roots.length === 0) findings.push(...(await bundleEntry(join(work, "bundle"))));
	} finally {
		await rm(work, { recursive: true, force: true });
	}

	sizes.sort((a, b) => b[1] - a[1]);
	const total = sizes.reduce((sum, [, size]) => sum + size, 0);
	console.log(`aot-verify: ${sizes.length} modules, ${total} B bytecode total`);
	for (const [file, size] of sizes.slice(0, 5)) {
		console.log(
			`  ${String(size).padStart(8)} B  ${file}${size > BYTECODE_WARN ? "  (over half the budget)" : ""}`,
		);
	}
	for (const f of findings) console.error(`FAIL [${f.rule}] ${f.file}: ${f.detail}`);
	console.log(
		findings.length === 0 ? "aot-verify: ok" : `aot-verify: ${findings.length} finding(s)`,
	);
	return findings.length === 0 ? 0 : 1;
}

process.exit(await main());

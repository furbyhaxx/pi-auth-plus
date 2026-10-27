/** Parses factory-time quota flags before Pi populates registered flag values. */
export const QUOTAS_JSON_FLAG = "quotas-json";
export const QUOTAS_LIST_FLAG = "quotas-list";

/** One read-only query; JSON wins when both output flags are present. */
export interface QuotaCliRequest {
	readonly json: boolean;
	readonly provider?: string | undefined;
}

const OWN_FLAGS = new Set([`--${QUOTAS_JSON_FLAG}`, `--${QUOTAS_LIST_FLAG}`]);

function positionalAfter(args: readonly string[], flag: string): string | undefined {
	for (const arg of args.slice(args.indexOf(flag) + 1)) {
		if (OWN_FLAGS.has(arg)) continue;
		return arg.startsWith("-") ? undefined : arg;
	}
	return undefined;
}

/** Ignores prompts after -- and leaves Pi's help, version and model listing alone. */
export function parseQuotaCliArgs(argv: readonly string[]): QuotaCliRequest | undefined {
	const separator = argv.indexOf("--");
	const args = separator < 0 ? argv : argv.slice(0, separator);
	if (args.some((arg) => ["--help", "-h", "--version", "-v", "--list-models"].includes(arg)))
		return undefined;
	const json = args.includes(`--${QUOTAS_JSON_FLAG}`);
	const flag = json ? `--${QUOTAS_JSON_FLAG}` : `--${QUOTAS_LIST_FLAG}`;
	if (!args.includes(flag)) return undefined;
	return { json, provider: positionalAfter(args, flag) };
}

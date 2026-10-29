/** Detects the process-wide offline policy. */

/** Returns whether the arguments or environment request offline operation. */
export function isOffline(
	args: readonly string[] = process.argv,
	env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	return (
		args.includes("--offline") ||
		["1", "true", "yes"].includes((env["PI_OFFLINE"] ?? "").toLowerCase())
	);
}

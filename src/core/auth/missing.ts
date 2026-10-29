/** Recognizes Pi's missing-environment credential errors. */
export function missingEnvironmentAuth(error: unknown, provider: string): boolean {
	if (
		!(error instanceof Error) ||
		error.name !== "ModelsError" ||
		!("code" in error) ||
		error.code !== "auth" ||
		!(error.cause instanceof Error)
	)
		return false;
	const prefix = `Failed to resolve API key for provider "${provider}" from environment variable`;
	return (
		error.cause.message.startsWith(`${prefix}: `) || error.cause.message.startsWith(`${prefix}s: `)
	);
}

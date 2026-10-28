/** Claude Code's bare PascalCase tool names and the request-local exact way back. */

export const PI_PLACEHOLDER = "__pi_deferred_placeholder__";

/** Two Pi tools that map to one wire name, which would make tool calls ambiguous. */
export class ToolNameCollisionError extends Error {
	override readonly name = "ToolNameCollisionError";

	constructor(first: string, second: string) {
		super(`claude: tools "${first}" and "${second}" share a wire name; rename one of them`);
	}
}

/** Preserves native MCP names and maps Pi tools to Claude Code names. */
export function wireToolName(name: string): string {
	if (name === PI_PLACEHOLDER) return "DeferredToolPlaceholder";
	if (name.startsWith("mcp__")) return name;
	return name
		.split(/[_-]/)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("");
}

/**
 * Restores exact request names plus the reserved placeholder; unknown names pass through.
 *
 * `current` tools must be wire-unique, because a response that names that wire name is
 * dispatched against them. Names from earlier transcript entries only fill free slots: a tool
 * that a session once called and Pi no longer offers can fold onto a live one, and that must
 * not block every later request in that session.
 */
export function toolNameRestorer(
	current: Iterable<string>,
	earlier: Iterable<string> = [],
): (wire: string) => string {
	const byWire = new Map<string, string>();
	for (const name of [PI_PLACEHOLDER, ...current]) {
		const wire = wireToolName(name);
		const previous = byWire.get(wire);
		if (previous !== undefined && previous !== name)
			throw new ToolNameCollisionError(previous, name);
		byWire.set(wire, name);
	}
	for (const name of earlier) {
		const wire = wireToolName(name);
		if (!byWire.has(wire)) byWire.set(wire, name);
	}
	return (wire) => byWire.get(wire) ?? wire;
}

/** Claude Code's wire tool names (`mcp_` plus an upper-case first letter) and the exact way back. */

export const TOOL_PREFIX = "mcp_";

/** Two Pi tools that map to one wire name, which would make tool calls ambiguous. */
export class ToolNameCollisionError extends Error {
	override readonly name = "ToolNameCollisionError";

	constructor(first: string, second: string) {
		super(`claude: tools "${first}" and "${second}" share a wire name; rename one of them`);
	}
}

/** The name Claude Code would send for a Pi tool; lower-case `mcp_bash` marks a foreign client. */
export function wireToolName(name: string): string {
	return `${TOOL_PREFIX}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/**
 * Maps wire names back to the request's Pi tool names, so custom PascalCase names survive.
 * Names without the prefix pass through; unknown prefixed names lose the prefix and their
 * first letter is lower-cased, except `StructuredOutput`, which Claude Code keeps as is.
 */
export function toolNameRestorer(names: Iterable<string>): (wire: string) => string {
	const byWire = new Map<string, string>();
	for (const name of names) {
		const wire = wireToolName(name);
		const previous = byWire.get(wire);
		if (previous !== undefined && previous !== name)
			throw new ToolNameCollisionError(previous, name);
		byWire.set(wire, name);
	}
	return (wire) => {
		const known = byWire.get(wire);
		if (known !== undefined) return known;
		if (!wire.startsWith(TOOL_PREFIX)) return wire;
		const bare = wire.slice(TOOL_PREFIX.length);
		if (bare === "StructuredOutput") return bare;
		return `${bare.charAt(0).toLowerCase()}${bare.slice(1)}`;
	};
}

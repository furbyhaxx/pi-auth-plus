/** Parses Pi's JSONC dialect while retaining object member spans. */
export interface Node {
	readonly start: number;
	readonly end: number;
	readonly members?: readonly Member[];
}
export interface Member {
	readonly key: string;
	readonly start: number;
	readonly value: Node;
	readonly comma?: number;
}

export function parseJsonc(text: string): { root: Node; value: unknown } {
	const lexical = text
		.replace(/^\ufeff/, " ")
		.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (match) =>
			match.startsWith('"') ? match : match.replace(/[^\r\n]/g, " "),
		);
	const cleaned = lexical.replace(
		/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g,
		(match, tail: string | undefined) => (tail === undefined ? match : ` ${tail}`),
	);
	let value: unknown;
	try {
		value = JSON.parse(cleaned);
	} catch {
		throw new Error("models.json is malformed; correct it before editing");
	}
	let pos = 0;
	function whitespace(): void {
		while (/\s/.test(lexical[pos] ?? "") && pos < lexical.length) pos++;
	}
	function stringEnd(): number {
		pos++;
		while (pos < cleaned.length) {
			const ch = cleaned[pos++];
			if (ch === "\\") pos++;
			else if (ch === '"') return pos;
		}
		throw new Error("models.json is malformed; correct it before editing");
	}
	function node(): Node {
		whitespace();
		const start = pos;
		const ch = cleaned[pos];
		if (ch === "{") {
			pos++;
			const members: Member[] = [];
			const keys = new Set<string>();
			whitespace();
			while (cleaned[pos] !== "}") {
				const memberStart = pos;
				const end = stringEnd();
				const key: string = JSON.parse(cleaned.slice(memberStart, end));
				if (keys.has(key))
					throw new Error("models.json contains duplicate keys; resolve them before editing");
				keys.add(key);
				whitespace();
				pos++;
				const value = node();
				whitespace();
				const comma = text[pos] === "," ? pos++ : undefined;
				members.push({ key, start: memberStart, value, ...(comma === undefined ? {} : { comma }) });
				whitespace();
			}
			pos++;
			return { start, end: pos, members };
		}
		if (ch === "[") {
			pos++;
			whitespace();
			while (cleaned[pos] !== "]") {
				node();
				whitespace();
				if (lexical[pos] === ",") pos++;
				whitespace();
			}
			pos++;
			return { start, end: pos };
		}
		if (ch === '"') stringEnd();
		else while (pos < cleaned.length && !/[\s,}\]]/.test(cleaned[pos] ?? "")) pos++;
		return { start, end: pos };
	}
	const root = node();
	return { root, value };
}

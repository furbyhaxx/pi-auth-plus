/** Local typed editors for provider lists and literal prompt rules. */
import {
	Input,
	matchesKey,
	sliceByColumn,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { SETTINGS } from "../../core/config/catalog.ts";
import type { FieldOption, TextRule } from "../../core/config/fields.ts";
import { sanitize } from "../frame/index.ts";
import type { TabBody, TabView, TabViewHost } from "./view.ts";

type ListKey = "quotas.providers" | "openai.verbosityProviders";
type DetailArgs =
	| [
			TabViewHost,
			ListKey,
			readonly string[],
			readonly FieldOption[],
			(value: readonly string[]) => void,
			() => void,
	  ]
	| [
			TabViewHost,
			"claude.replacePatterns",
			readonly TextRule[],
			(value: readonly TextRule[]) => void,
			() => void,
	  ];
type Data =
	| {
			kind: "list";
			key: ListKey;
			original: readonly string[];
			value: string[];
			choices: readonly FieldOption[];
			stage: (value: readonly string[]) => void;
	  }
	| {
			kind: "rules";
			original: readonly TextRule[];
			value: TextRule[];
			stage: (value: readonly TextRule[]) => void;
	  };
type Row =
	| { kind: "choice"; value: string; label: string }
	| { kind: "unknown"; index: number; value: string }
	| { kind: "add-provider" }
	| { kind: "match"; index: number }
	| { kind: "action"; index: number }
	| { kind: "replacement"; index: number }
	| { kind: "add-rule"; drop: boolean };
type EditableRow = Extract<Row, { kind: "add-provider" | "match" | "replacement" }>;

const clean = (value: string) => sanitize(value).replace(/\n/g, " ");
const copyRules = (rules: readonly TextRule[]): TextRule[] => rules.map((rule) => ({ ...rule }));
const reservedBindings = [
	"tui.select.confirm",
	"tui.select.cancel",
	"tui.select.up",
	"tui.select.down",
	"tui.editor.cursorLeft",
	"tui.editor.cursorRight",
] as const;
const reorderKeys = [
	{
		up: "shift+up",
		down: "shift+down",
		upInput: "\x1b[1;2A",
		downInput: "\x1b[1;2B",
		label: "shift+↑/↓",
	},
	{
		up: "alt+up",
		down: "alt+down",
		upInput: "\x1b[1;3A",
		downInput: "\x1b[1;3B",
		label: "alt+↑/↓",
	},
	{
		up: "ctrl+up",
		down: "ctrl+down",
		upInput: "\x1b[1;5A",
		downInput: "\x1b[1;5B",
		label: "ctrl+↑/↓",
	},
] as const;

/** A nested editor that stages a validated collection back to its owner. */
export class CollectionDetail implements TabView {
	readonly #host: TabViewHost;
	readonly #back: () => void;
	readonly #data: Data;
	#input = new Input({ prompt: "", placeholder: "" });
	readonly #replacements = new WeakMap<TextRule, string>();
	#edit: { row: EditableRow; initial: string } | undefined;
	#pasting = false;
	#pasteDirty = false;
	#selected = 0;
	#offset = 0;
	#detailOffset = 0;
	#showIdentity = false;
	#width = 80;
	#message = "";
	#disposed = false;

	constructor(
		host: TabViewHost,
		key: ListKey,
		initial: readonly string[],
		choices: readonly FieldOption[],
		stage: (value: readonly string[]) => void,
		back: () => void,
	);
	constructor(
		host: TabViewHost,
		key: "claude.replacePatterns",
		initial: readonly TextRule[],
		stage: (value: readonly TextRule[]) => void,
		back: () => void,
	);
	constructor(...args: DetailArgs) {
		this.#host = args[0];
		if (args[1] === "claude.replacePatterns") {
			const [, , initial, stage, back] = args;
			this.#back = back;
			this.#data = {
				kind: "rules",
				original: copyRules(initial),
				value: copyRules(initial),
				stage,
			};
		} else {
			const [, key, initial, choices, stage, back] = args;
			this.#back = back;
			this.#data = {
				kind: "list",
				key,
				original: [...initial],
				value: [...initial],
				choices,
				stage,
			};
		}
	}

	/** Include input not yet committed to its row in the owner's draft accounting. */
	hasDrafts(): boolean {
		if (this.#pasteDirty || (this.#edit && this.#input.getValue() !== this.#edit.initial))
			return true;
		const data = this.#data;
		if (data.value.length !== data.original.length) return true;
		if (data.kind === "list")
			return data.value.some((value, index) => value !== data.original[index]);
		return data.value.some((rule, index) => {
			const original = data.original[index];
			return (
				!original || rule.match !== original.match || rule.replacement !== original.replacement
			);
		});
	}

	/** Discard only this collection and any in-progress input. */
	discardDrafts(): void {
		const data = this.#data;
		data.value = data.kind === "list" ? [...data.original] : copyRules(data.original);
		this.#edit = undefined;
		this.#pasting = false;
		this.#pasteDirty = false;
		this.#selected = 0;
		this.#offset = 0;
		this.#detailOffset = 0;
		this.#showIdentity = false;
		this.#message = "";
	}

	/** This in-memory editor never saves to storage. */
	isSaving(): boolean {
		return false;
	}

	#rows(): Row[] {
		const data = this.#data;
		if (data.kind === "list") {
			return [
				...data.choices.map((choice): Row => ({ kind: "choice", ...choice })),
				...data.value.flatMap((value, index): Row[] =>
					data.choices.some((choice) => choice.value === value)
						? []
						: [{ kind: "unknown", index, value }],
				),
				{ kind: "add-provider" },
			];
		}
		return [
			...data.value.flatMap((rule, index): Row[] => [
				{ kind: "match", index },
				{ kind: "action", index },
				...(rule.replacement === undefined ? [] : [{ kind: "replacement", index } as const]),
			]),
			{ kind: "add-rule", drop: false },
			{ kind: "add-rule", drop: true },
		];
	}

	#start(row: EditableRow): void {
		const rule =
			this.#data.kind === "rules" && row.kind !== "add-provider"
				? this.#data.value[row.index]
				: undefined;
		const value =
			row.kind === "match"
				? (rule?.match ?? "")
				: row.kind === "replacement"
					? (rule?.replacement ?? "")
					: "";
		const initial = clean(value);
		this.#input = new Input({ prompt: "", placeholder: "" });
		this.#input.focused = true;
		if (initial) this.#input.handleInput(`\x1b[200~${initial}\x1b[201~`);
		this.#edit = { row, initial };
		this.#message = "";
	}

	#finishEdit(): void {
		const edit = this.#edit;
		if (!edit) return;
		const value = clean(this.#input.getValue());
		const data = this.#data;
		if (edit.row.kind === "add-provider" && data.kind === "list") {
			if (value !== "") data.value.push(value);
		} else if (edit.row.kind !== "add-provider" && data.kind === "rules") {
			const rule = data.value[edit.row.index];
			if (rule) {
				const updated = { ...rule, [edit.row.kind]: value };
				const replacement = this.#replacements.get(rule);
				if (replacement !== undefined) this.#replacements.set(updated, replacement);
				data.value[edit.row.index] = updated;
			}
		}
		this.#edit = undefined;
		this.#message = "";
	}

	#available(input: string): boolean {
		return reservedBindings.every((binding) => !this.#host.keys.matches(input, binding));
	}

	#applyKey(): "ctrl+s" | "ctrl+g" | "ctrl+o" {
		for (const [key, input] of [
			["ctrl+s", "\x13"],
			["ctrl+g", "\x07"],
			["ctrl+o", "\x0f"],
		] as const) {
			if (this.#available(input)) return key;
		}
		return "ctrl+o";
	}

	#removeKey(): "d" | "x" | "r" | "delete" {
		for (const key of ["d", "x", "r", "delete"] as const) {
			if (this.#available(key === "delete" ? "\x1b[3~" : key)) return key;
		}
		return "delete";
	}

	#reorderKeys(): (typeof reorderKeys)[number] {
		return (
			reorderKeys.find(
				({ upInput, downInput }) => this.#available(upInput) && this.#available(downInput),
			) ?? reorderKeys[0]
		);
	}

	#apply(): void {
		this.#finishEdit();
		const data = this.#data;
		if (data.kind === "list") {
			const parsed = SETTINGS[data.key].parse(data.value);
			if (parsed === undefined) {
				this.#message = "Invalid provider list; edit and retry";
				return;
			}
			data.original = [...parsed];
			data.value = [...parsed];
			data.stage([...parsed]);
		} else {
			const parsed = SETTINGS["claude.replacePatterns"].parse(data.value);
			if (parsed === undefined) {
				const invalid = data.value.findIndex(
					(rule) => SETTINGS["claude.replacePatterns"].parse([rule]) === undefined,
				);
				const selected = this.#rows().findIndex(
					(row) => row.kind === "match" && row.index === invalid,
				);
				if (selected >= 0) this.#selected = selected;
				this.#message = `Match required; edit or ${this.#removeKey()} delete`;
				return;
			}
			data.original = copyRules(parsed);
			data.value = copyRules(parsed);
			data.stage(copyRules(parsed));
		}
		this.#message = "";
	}

	#backFromDetail(): void {
		if (!this.hasDrafts()) {
			this.#back();
			return;
		}
		if (!this.#host.confirmDiscard) {
			this.#message = "Cannot discard; stage or keep editing";
			return;
		}
		this.#host.confirmDiscard(() => {
			if (this.#disposed) return;
			this.discardDrafts();
			this.#back();
		});
	}

	#moveRule(row: Extract<Row, { index: number }>, direction: number): void {
		const data = this.#data;
		if (data.kind !== "rules" || row.kind === "unknown") return;
		const next = row.index + direction;
		const current = data.value[row.index];
		const other = data.value[next];
		if (!current || !other) return;
		data.value[next] = current;
		data.value[row.index] = other;
		const rows = this.#rows();
		const selected = rows.findIndex(
			(candidate) => candidate.kind === row.kind && candidate.index === next,
		);
		this.#selected =
			selected >= 0
				? selected
				: rows.findIndex((candidate) => candidate.kind === "match" && candidate.index === next);
	}

	#receiveText(input: string): void {
		this.#input.handleInput(input);
		const value = this.#input.getValue();
		const safe = clean(value);
		if (safe !== value) this.#input.setValue(safe);
	}

	/** Consume keys within the nested editor. */
	handleInput(input: string): boolean {
		if (this.#edit && (this.#pasting || input.includes("\x1b[200~"))) {
			this.#pasting = true;
			if (input.replace("\x1b[200~", "").replace("\x1b[201~", "") !== "") this.#pasteDirty = true;
			this.#receiveText(input);
			if (input.includes("\x1b[201~")) {
				this.#pasting = false;
				this.#pasteDirty = false;
			}
			return true;
		}
		const { keys } = this.#host;
		const cancel = keys.matches(input, "tui.select.cancel");
		const enter = keys.matches(input, "tui.select.confirm");
		if (cancel) {
			this.#backFromDetail();
			return true;
		}
		if (matchesKey(input, this.#applyKey())) {
			this.#apply();
			return true;
		}
		if (this.#edit) {
			if (enter) this.#finishEdit();
			else this.#receiveText(input);
			return true;
		}
		const rows = this.#rows();
		const row = rows[this.#selected];
		if (!row) return true;
		const up = keys.matches(input, "tui.select.up");
		const down = keys.matches(input, "tui.select.down");
		const left = keys.matches(input, "tui.editor.cursorLeft");
		const right = keys.matches(input, "tui.editor.cursorRight");
		const reorder = this.#reorderKeys();
		if (up || down) {
			this.#selected = Math.max(0, Math.min(rows.length - 1, this.#selected + (up ? -1 : 1)));
			this.#detailOffset = 0;
			this.#showIdentity = false;
		} else if (
			!enter &&
			(row.kind === "choice" || row.kind === "unknown") &&
			(left || right || input === "h" || input === "l")
		) {
			const max = Math.max(0, visibleWidth(clean(row.value)) - Math.max(1, this.#width - 9));
			if (!this.#showIdentity) this.#showIdentity = true;
			else if ((left || input === "h") && this.#detailOffset === 0) this.#showIdentity = false;
			else
				this.#detailOffset = Math.max(
					0,
					Math.min(max, this.#detailOffset + (left || input === "h" ? -8 : 8)),
				);
		} else if (!enter && (input === "k" || input === "j")) {
			this.#selected = Math.max(
				0,
				Math.min(rows.length - 1, this.#selected + (input === "k" ? -1 : 1)),
			);
			this.#detailOffset = 0;
			this.#showIdentity = false;
		} else if (
			!enter &&
			"index" in row &&
			(matchesKey(input, reorder.up) || matchesKey(input, reorder.down))
		) {
			this.#moveRule(row, matchesKey(input, reorder.up) ? -1 : 1);
		} else if (!enter && "index" in row && matchesKey(input, this.#removeKey())) {
			const data = this.#data;
			if (data.kind === "list" && row.kind === "unknown") data.value.splice(row.index, 1);
			else if (data.kind === "rules" && row.kind !== "unknown") data.value.splice(row.index, 1);
			this.#selected = Math.min(this.#selected, this.#rows().length - 1);
			this.#detailOffset = 0;
			this.#showIdentity = false;
			this.#message = "";
		} else if (enter || input === " ") {
			const data = this.#data;
			if (row.kind === "choice" && data.kind === "list") {
				data.value = data.value.includes(row.value)
					? data.value.filter((value) => value !== row.value)
					: [...data.value, row.value];
			} else if (row.kind === "unknown" && data.kind === "list") {
				data.value.splice(row.index, 1);
				this.#selected = Math.min(this.#selected, this.#rows().length - 1);
				this.#detailOffset = 0;
				this.#showIdentity = false;
			} else if (row.kind === "action" && data.kind === "rules") {
				const rule = data.value[row.index];
				if (rule) {
					if (rule.replacement === undefined) {
						data.value[row.index] = {
							match: rule.match,
							replacement: this.#replacements.get(rule) ?? "",
						};
					} else {
						const drop = { match: rule.match };
						this.#replacements.set(drop, rule.replacement);
						data.value[row.index] = drop;
					}
				}
			} else if (row.kind === "add-rule" && data.kind === "rules" && enter) {
				const index = data.value.length;
				data.value.push(row.drop ? { match: "" } : { match: "", replacement: "" });
				this.#selected = this.#rows().findIndex(
					(candidate) => candidate.kind === "match" && candidate.index === index,
				);
				this.#start({ kind: "match", index });
			} else if (
				enter &&
				(row.kind === "match" || row.kind === "replacement" || row.kind === "add-provider")
			)
				this.#start(row);
			this.#message = "";
		}
		return true;
	}

	/** Render the collection viewport with fixed help and actionable key hints. */
	render(width: number, bodyRows: number): TabBody {
		const { theme } = this.#host;
		const data = this.#data;
		const rows = this.#rows();
		const selected = rows[this.#selected];
		this.#width = width;
		if (selected?.kind === "choice" || selected?.kind === "unknown") {
			const max = Math.max(0, visibleWidth(clean(selected.value)) - Math.max(1, width - 9));
			this.#detailOffset = Math.min(this.#detailOffset, max);
		}
		const lines = rows.map((row, index) => {
			let label = "";
			let value = "";
			if (row.kind === "choice" && data.kind === "list") {
				label = `${data.value.includes(row.value) ? "[x]" : "[ ]"} ${clean(row.label)}`;
				value = clean(row.value);
			} else if (row.kind === "unknown") label = `Unknown id: ${clean(row.value)}`;
			else if (row.kind === "add-provider") label = "+ Add provider";
			else if (row.kind === "add-rule") label = row.drop ? "+ Add drop" : "+ Add rewrite";
			else if (data.kind === "rules" && "index" in row) {
				const rule = data.value[row.index];
				label = `Rule ${row.index + 1} ${row.kind}`;
				value =
					row.kind === "match"
						? (rule?.match ?? "")
						: row.kind === "replacement"
							? (rule?.replacement ?? "")
							: rule?.replacement === undefined
								? "drop"
								: "rewrite";
				value = clean(value) || "(empty)";
			}
			if (
				index === this.#selected &&
				this.#showIdentity &&
				(row.kind === "choice" || row.kind === "unknown")
			) {
				label = `ID: ${this.#detailOffset > 0 ? "…" : ""}${sliceByColumn(clean(row.value), this.#detailOffset, Math.max(1, width - 9), true)}`;
				value = "";
			}
			const prefix = ` ${index === this.#selected ? theme.fg("accent", "❯") : " "} ${label}`;
			if (this.#edit && index === this.#selected) {
				const input = this.#input.render(Math.max(1, width - visibleWidth(prefix) - 3))[0] ?? "";
				return `${prefix} · ${input}`;
			}
			return `${prefix}${value ? ` · ${value}` : ""}`;
		});
		const available = Math.max(0, bodyRows);
		this.#offset = Math.max(0, Math.min(this.#offset, this.#selected));
		this.#offset = Math.max(this.#offset, this.#selected - available + 1);
		this.#offset = Math.max(0, Math.min(this.#offset, lines.length - available));
		const binding = (id: Parameters<TabViewHost["binding"]>[0]) => this.#host.binding(id);
		const left = binding("tui.editor.cursorLeft");
		const right = binding("tui.editor.cursorRight");
		const horizontal = left && right ? `${left}/${right}` : "h/l";
		const remove = this.#removeKey();
		const reorder = this.#reorderKeys();
		const apply = this.#applyKey();
		const help =
			this.#message ||
			(this.#edit
				? this.#edit.row.kind === "add-provider"
					? "Edit custom provider ID"
					: "Edit literal field"
				: selected?.kind === "unknown"
					? `Unknown · ${remove} remove · ${horizontal} view`
					: selected?.kind === "choice" && data.kind === "list"
						? data.key === "quotas.providers"
							? `${horizontal} ID · empty = all sources`
							: `${horizontal} ID · toggle provider`
						: data.kind === "rules" && selected && "index" in selected
							? `Literal; ${remove} remove · ${reorder.label} move`
							: data.kind === "rules"
								? "Literal match; drop removes paragraph"
								: data.key === "quotas.providers"
									? "Empty list enables every source"
									: "Toggle providers or add a custom ID");
		const up = binding("tui.select.up");
		const down = binding("tui.select.down");
		return {
			lines: lines
				.slice(this.#offset, this.#offset + available)
				.map((line) => truncateToWidth(line, Math.max(0, width), "…")),
			above: this.#offset,
			below: Math.max(0, lines.length - this.#offset - available),
			modal: true,
			state: truncateToWidth(
				theme.fg("dim", this.hasDrafts() ? "staged" : "collection detail"),
				Math.max(0, width),
				"…",
			),
			description: truncateToWidth(
				theme.fg(this.#message ? "warning" : "muted", clean(help)),
				Math.max(0, width - 1),
				"…",
			),
			hints: this.#edit
				? [
						{ key: binding("tui.select.confirm"), action: "set", priority: 0 },
						{ key: apply, action: "apply", priority: 0 },
						{ key: binding("tui.select.cancel"), action: "back", priority: 0 },
					]
				: [
						{
							key: binding("tui.select.confirm"),
							action:
								selected?.kind === "unknown"
									? "remove"
									: selected?.kind === "choice" || selected?.kind === "action"
										? "toggle"
										: selected?.kind === "add-rule" || selected?.kind === "add-provider"
											? "add"
											: "edit",
							priority: 1,
						},
						{ key: up && down ? `${up}/${down}` : "k/j", action: "move", priority: 2 },
						...(selected && "index" in selected
							? [{ key: remove, action: "remove", priority: 1 }]
							: []),
						...(data.kind === "rules" && selected && "index" in selected
							? [{ key: reorder.label, action: "reorder", priority: 2 }]
							: []),
						{ key: apply, action: "apply", priority: 0 },
						{ key: binding("tui.select.cancel"), action: "back", priority: 0 },
					],
		};
	}

	/** Prevent a pending local confirmation from changing a disposed editor. */
	dispose(): void {
		this.#disposed = true;
	}
}

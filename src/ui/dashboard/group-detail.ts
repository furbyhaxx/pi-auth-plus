/** Local editor for a single model group. */
import { Input, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type ModelGroup, parseGroups } from "../../models/groups/config.ts";
import { isPhysicalGroupMember } from "../../models/groups/member.ts";
import { sanitize } from "../frame/index.ts";
import { ModelPicker } from "./model-picker.ts";
import type { ModelCatalogItem } from "./models.ts";
import type { TabBody, TabViewHost } from "./view.ts";

type DraftMember = {
	provider: string;
	id: string;
	tier: string;
	cost: (typeof costs)[number];
	thinking: string;
};
type Draft = {
	id: string;
	name: string;
	strategy: ModelGroup["strategy"];
	cap: string;
	triggers: ModelGroup["triggers"][number][];
	members: DraftMember[];
};
type Row = {
	kind:
		| "id"
		| "name"
		| "strategy"
		| "cap"
		| "trigger"
		| "member"
		| "tier"
		| "cost"
		| "thinking"
		| "add";
	index?: number;
	label: string;
	value: string;
};
const strategies = ["sticky", "failover", "balance", "random"] as const;
const triggers = ["rate-limit", "quota", "auth"] as const;
const costs = ["unset", "included", "free", "paid"] as const;
const clean = (value: string) => sanitize(value).replace(/\n/g, " ");
function draft(group: ModelGroup | undefined): Draft {
	return {
		id: group?.id ?? "",
		name: group?.name ?? "",
		strategy: group?.strategy ?? "sticky",
		cap: group?.contextWindow === undefined ? "" : String(group.contextWindow),
		triggers: [...(group?.triggers ?? triggers)],
		members: (group?.members ?? []).map((member) => ({
			provider: member.provider,
			id: member.id,
			tier: String(member.tier),
			cost: member.cost ?? "unset",
			thinking: Object.entries(member.thinking ?? {})
				.map(([from, to]) => `${from}=${to}`)
				.join(", "),
		})),
	};
}
function integer(raw: string): number {
	return /^\d+$/.test(raw.trim()) && Number.isSafeInteger(Number(raw)) ? Number(raw) : NaN;
}

/** An editor whose validated result is handed to the owning Groups view. */
export class GroupDetail {
	readonly #host: TabViewHost;
	readonly #catalog: () => readonly ModelCatalogItem[];
	readonly #done: (group: ModelGroup) => void;
	readonly #back: () => void;
	readonly #input = new Input({ prompt: "", placeholder: "" });
	readonly #original: Draft;
	#draft: Draft;
	#picker: ModelPicker | undefined;
	#inputInitial = "";
	#selected = 0;
	#offset = 0;
	#editing = false;
	#message = "";
	#disposed = false;

	constructor(
		host: TabViewHost,
		initial: ModelGroup | undefined,
		catalog: () => readonly ModelCatalogItem[],
		done: (group: ModelGroup) => void,
		back: () => void,
	) {
		this.#host = host;
		this.#catalog = catalog;
		this.#done = done;
		this.#back = back;
		this.#original = draft(initial);
		this.#draft = draft(initial);
	}
	#dirty(): boolean {
		return JSON.stringify(this.#draft) !== JSON.stringify(this.#original);
	}
	/** True when this editor or its active input contains unsaved changes. */
	hasDrafts(): boolean {
		return this.#dirty() || (this.#editing && this.#input.getValue() !== this.#inputInitial);
	}
	/** Group detail has no asynchronous operation of its own. */
	isSaving(): boolean {
		return false;
	}
	/** Reset all local fields to the value this editor was opened with. */
	discardDrafts(): void {
		this.#draft = draftFromDraft(this.#original);
		this.#picker = undefined;
		this.#editing = false;
		this.#inputInitial = "";
		this.#input.setValue("");
		this.#input.focused = false;
		this.#selected = 0;
		this.#offset = 0;
		this.#message = "";
	}
	#rows(): Row[] {
		const d = this.#draft;
		return [
			{ kind: "id", label: "Group ID", value: d.id },
			{ kind: "name", label: "Display name", value: d.name || "(unset)" },
			{ kind: "strategy", label: "Strategy", value: d.strategy },
			{ kind: "cap", label: "Context window", value: d.cap || "minimum member" },
			...triggers.map(
				(trigger, index): Row => ({
					kind: "trigger",
					index,
					label: `Trigger ${trigger}`,
					value: d.triggers.includes(trigger) ? "on" : "off",
				}),
			),
			...d.members.flatMap((member, index): Row[] => [
				{
					kind: "member",
					index,
					label: `Member ${index + 1}`,
					value: `${member.provider}/${member.id}`,
				},
				{ kind: "tier", index, label: "  Priority tier", value: member.tier },
				{ kind: "cost", index, label: "  Cost label", value: member.cost },
				{ kind: "thinking", index, label: "  Thinking map", value: member.thinking || "(unset)" },
			]),
			{ kind: "add", label: "+ Add member", value: "" },
		];
	}
	#start(row: Row): void {
		const member = row.index === undefined ? undefined : this.#draft.members[row.index];
		const value =
			row.kind === "id"
				? this.#draft.id
				: row.kind === "name"
					? this.#draft.name
					: row.kind === "cap"
						? this.#draft.cap
						: row.kind === "tier"
							? (member?.tier ?? "")
							: row.kind === "thinking"
								? (member?.thinking ?? "")
								: "";
		this.#input.setValue("");
		if (value) this.#input.handleInput(`\x1b[200~${clean(value)}\x1b[201~`);
		this.#inputInitial = this.#input.getValue();
		this.#input.focused = true;
		this.#editing = true;
		this.#message = "";
	}
	#openPicker(): void {
		this.#picker = new ModelPicker(
			this.#host,
			() =>
				this.#catalog().filter(
					(item) =>
						isPhysicalGroupMember(item) &&
						!this.#draft.members.some(
							(member) => member.provider === item.provider && member.id === item.id,
						),
				),
			(item) => {
				this.#draft.members.push({
					provider: item.provider,
					id: item.id,
					tier: "1",
					cost: "unset",
					thinking: "",
				});
				this.#picker = undefined;
			},
			() => {
				this.#picker = undefined;
			},
		);
	}
	#finishEdit(row: Row): boolean {
		const value = clean(this.#input.getValue());
		const member = row.index === undefined ? undefined : this.#draft.members[row.index];
		if (row.kind === "id") this.#draft.id = value;
		else if (row.kind === "name") this.#draft.name = value;
		else if (row.kind === "cap") this.#draft.cap = value;
		else if (row.kind === "tier" && member) member.tier = value;
		else if (row.kind === "thinking" && member) member.thinking = value;
		this.#editing = false;
		this.#inputInitial = "";
		this.#input.focused = false;
		this.#message = "";
		return true;
	}
	#save(): void {
		const d = this.#draft;
		if (d.cap.trim() && (!Number.isSafeInteger(integer(d.cap)) || integer(d.cap) <= 0)) {
			this.#message = "Context window must be a positive integer";
			return;
		}
		const catalog = this.#catalog();
		const resolved = d.members.map((member) => ({
			member,
			model: catalog.find((item) => item.provider === member.provider && item.id === member.id),
		}));
		const invalid = resolved.find(({ member, model }) => !isPhysicalGroupMember(model ?? member));
		if (invalid) {
			this.#message = `Delete nonphysical member; choose a physical model (${invalid.member.provider}/${invalid.member.id})`;
			return;
		}
		const limits = resolved.flatMap(({ model }) =>
			model && Number.isFinite(model.contextWindow) && model.contextWindow > 0
				? [model.contextWindow]
				: [],
		);
		const smallest = limits.length ? Math.min(...limits) : undefined;
		if (d.cap.trim() && smallest !== undefined && integer(d.cap) > smallest) {
			this.#message = `Context window cannot exceed smallest member (${smallest})`;
			return;
		}
		const members: unknown[] = [];
		for (const member of d.members) {
			const thinking: Record<string, string> = {};
			if (member.thinking.trim()) {
				for (const part of member.thinking.split(",")) {
					const match = /^\s*([a-z]+)\s*=\s*([a-z]+)\s*$/.exec(part);
					if (!match?.[1] || !match[2] || Object.hasOwn(thinking, match[1])) {
						this.#message = "Invalid thinking map; use low=high, ...";
						return;
					}
					thinking[match[1]] = match[2];
				}
			}
			members.push({
				provider: member.provider,
				id: member.id,
				tier: integer(member.tier),
				...(member.cost === "unset" ? {} : { cost: member.cost }),
				...(member.thinking.trim() ? { thinking } : {}),
			});
		}
		const candidate = {
			id: d.id,
			...(d.name ? { name: d.name } : {}),
			strategy: d.strategy,
			...(d.cap.trim() ? { contextWindow: integer(d.cap) } : {}),
			triggers: d.triggers,
			members,
		};
		const group = parseGroups([candidate])?.[0];
		if (!group) {
			this.#message = "Invalid group: check ID, members, tier, cap and thinking map";
			return;
		}
		this.#message = "";
		this.#done(group);
	}
	/** Consume editor input, returning through the explicit back callback. */
	handleInput(data: string): boolean {
		if (this.#disposed) return true;
		if (this.#picker) return this.#picker.handleInput(data);
		const { keys } = this.#host;
		const cancel = keys.matches(data, "tui.select.cancel");
		const enter = keys.matches(data, "tui.select.confirm");
		const rows = this.#rows();
		const row = rows[this.#selected];
		if (!row) return true;
		if (this.#editing) {
			if (cancel) {
				this.#input.setValue(this.#inputInitial);
				this.#inputInitial = "";
				this.#input.focused = false;
				this.#editing = false;
				this.#message = "";
			} else if (enter) this.#finishEdit(row);
			else if (matchesKey(data, "ctrl+s")) {
				if (this.#finishEdit(row)) this.#save();
			} else this.#input.handleInput(data);
			return true;
		}
		if (cancel) {
			if (!this.hasDrafts()) {
				this.#back();
				return true;
			}
			if (this.#host.confirmDiscard) {
				this.#host.confirmDiscard(() => {
					if (this.#disposed) return;
					this.discardDrafts();
					this.#back();
				});
			}
			return true;
		}
		if (matchesKey(data, "ctrl+s")) {
			this.#save();
			return true;
		}
		const memberIndex = row.index;
		if (memberIndex !== undefined && ["member", "tier", "cost", "thinking"].includes(row.kind)) {
			if (data === "d") {
				this.#draft.members.splice(memberIndex, 1);
				this.#selected = Math.min(this.#selected, this.#rows().length - 1);
				this.#message = "";
				return true;
			}
			if (matchesKey(data, "shift+up") || matchesKey(data, "shift+down")) {
				const next = memberIndex + (matchesKey(data, "shift+up") ? -1 : 1);
				const current = this.#draft.members[memberIndex];
				const other = this.#draft.members[next];
				if (current && other) {
					this.#draft.members[next] = current;
					this.#draft.members[memberIndex] = other;
					this.#selected += (next - memberIndex) * 4;
				}
				return true;
			}
		}
		if (keys.matches(data, "tui.select.up") || data === "k")
			this.#selected = Math.max(0, this.#selected - 1);
		else if (keys.matches(data, "tui.select.down") || data === "j")
			this.#selected = Math.min(rows.length - 1, this.#selected + 1);
		else {
			const left = keys.matches(data, "tui.editor.cursorLeft") || data === "h";
			const right = keys.matches(data, "tui.editor.cursorRight") || data === "l";
			if (enter || data === " " || left || right) {
				if (row.kind === "strategy") {
					const index = strategies.indexOf(this.#draft.strategy);
					this.#draft.strategy =
						strategies[(index + (left ? -1 : 1) + strategies.length) % strategies.length] ??
						"sticky";
				} else if (row.kind === "trigger" && row.index !== undefined) {
					const trigger = triggers[row.index];
					if (trigger)
						this.#draft.triggers = this.#draft.triggers.includes(trigger)
							? this.#draft.triggers.filter((value) => value !== trigger)
							: [...this.#draft.triggers, trigger];
				} else if (row.kind === "cost" && memberIndex !== undefined) {
					const member = this.#draft.members[memberIndex];
					if (member)
						member.cost =
							costs[
								(Math.max(0, costs.indexOf(member.cost)) + (left ? -1 : 1) + costs.length) %
									costs.length
							] ?? "unset";
				} else if (enter && row.kind === "add") this.#openPicker();
				else if (enter && ["id", "name", "cap", "tier", "thinking"].includes(row.kind))
					this.#start(row);
				this.#message = "";
			}
		}
		return true;
	}
	/** Render a clipped scrollable body and the available editing controls. */
	render(width: number, bodyRows: number): TabBody {
		if (this.#picker) return this.#picker.render(width, bodyRows);
		const { theme } = this.#host;
		const rows = this.#rows();
		const catalog = this.#draft.members.length ? this.#catalog() : [];
		const lines = rows.map((row, index) => {
			const prefix = ` ${index === this.#selected ? theme.fg("accent", "❯") : " "} ${row.label}`;
			if (this.#editing && index === this.#selected) {
				const input = this.#input.render(Math.max(1, width - visibleWidth(prefix) - 3))[0] ?? "";
				return `${prefix} · ${input}`;
			}
			const member =
				row.kind === "member" && row.index !== undefined
					? this.#draft.members[row.index]
					: undefined;
			const model =
				member &&
				catalog.find((item) => item.provider === member.provider && item.id === member.id);
			const status =
				member && !isPhysicalGroupMember(model ?? member)
					? "not physical; delete · "
					: member && !model
						? "not in catalog · "
						: "";
			return `${prefix}${row.value ? ` · ${status}${clean(row.value)}` : ""}`;
		});
		const details = this.#message ? [` ${theme.fg("warning", clean(this.#message))}`] : [];
		const reserved = Math.min(details.length, Math.max(0, bodyRows - 1));
		const available = Math.max(0, bodyRows - reserved);
		this.#offset = Math.max(0, Math.min(this.#offset, this.#selected));
		this.#offset = Math.max(this.#offset, this.#selected - available + 1);
		this.#offset = Math.max(0, Math.min(this.#offset, lines.length - available));
		const binding = (id: Parameters<TabViewHost["binding"]>[0]) => this.#host.binding(id);
		return {
			lines: [
				...lines.slice(this.#offset, this.#offset + available),
				...details.slice(0, reserved),
			].map((line) => truncateToWidth(line, Math.max(0, width), "…")),
			above: this.#offset,
			below: Math.max(0, lines.length - this.#offset - available),
			modal: true,
			state: truncateToWidth(
				theme.fg("dim", this.#dirty() ? "staged" : "group detail"),
				Math.max(0, width),
				"…",
			),
			description: truncateToWidth(
				theme.fg(
					"muted",
					this.#editing && rows[this.#selected]?.kind === "thinking"
						? "Mappings: low=high, medium=max"
						: "Cost labels are informational.",
				),
				Math.max(0, width - 1),
				"…",
			),
			hints: this.#editing
				? [
						{ key: binding("tui.select.confirm"), action: "stage", priority: 0 },
						{ key: binding("tui.select.cancel"), action: "cancel edit", priority: 0 },
					]
				: [
						{ key: binding("tui.select.confirm"), action: "edit/toggle", priority: 0 },
						{
							key: `${binding("tui.editor.cursorLeft")}/${binding("tui.editor.cursorRight")}`,
							action: "change",
							priority: 1,
						},
						{ key: "d", action: "delete member", priority: 1 },
						{ key: "shift+↑/↓", action: "reorder member", priority: 1 },
						{ key: "ctrl+s", action: "stage group", priority: 0 },
						{ key: binding("tui.select.cancel"), action: "discard/back", priority: 0 },
					],
		};
	}
	/** Release editor resources when the owner closes the view. */
	dispose(): void {
		this.#disposed = true;
		this.#picker = undefined;
		this.#input.focused = false;
	}
}
function draftFromDraft(value: Draft): Draft {
	return {
		...value,
		triggers: [...value.triggers],
		members: value.members.map((member) => ({ ...member })),
	};
}

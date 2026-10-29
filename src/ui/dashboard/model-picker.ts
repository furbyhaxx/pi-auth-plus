/** A shared, searchable catalog picker; owners may intercept action keys while not editing. */
import {
	decodeKittyPrintable,
	Input,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { sanitize } from "../frame/index.ts";
import type { ModelCatalogItem } from "./models.ts";
import type { TabBody, TabViewHost } from "./view.ts";

type SearchItem = {
	readonly provider: string;
	readonly id: string;
	readonly name: string;
	readonly searchable: string;
};

const clean = (value: string) => sanitize(value).replace(/\n/g, " ");
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function wrapIdentity(value: string, width: number): string[] {
	const lines: string[] = [];
	let line = "";
	let used = 0;
	for (const { segment } of segmenter.segment(value)) {
		const columns = visibleWidth(segment);
		if (line && used + columns > width) {
			lines.push(line);
			line = "";
			used = 0;
		}
		line += segment;
		used += columns;
	}
	lines.push(line);
	return lines;
}

/** Search, inspect and choose from a live catalog without owning its contents. */
export class ModelPicker {
	readonly #host: TabViewHost;
	readonly #catalog: () => readonly ModelCatalogItem[];
	readonly #choose: (item: ModelCatalogItem) => void;
	readonly #cancel: () => void;
	readonly #annotation: ((item: ModelCatalogItem, index: number) => string) | undefined;
	readonly #input = new Input({ prompt: "", placeholder: "provider/id or name" });
	#snapshot: readonly SearchItem[] = [];
	#matches: number[] = [];
	#query: string | undefined;
	#selected = 0;
	#editing = false;
	#pasting = false;
	#inspecting = false;
	#pageSize = 1;
	#detailOffset = 0;
	#detailPageSize = 1;
	#detailMaxOffset = 0;

	/** The catalog getter reads in-memory state; choose receives the latest matching item. */
	constructor(
		host: TabViewHost,
		catalog: () => readonly ModelCatalogItem[],
		onChoose: (item: ModelCatalogItem) => void,
		onCancel: () => void,
		annotation?: (item: ModelCatalogItem, index: number) => string,
	) {
		this.#host = host;
		this.#catalog = catalog;
		this.#choose = onChoose;
		this.#cancel = onCancel;
		this.#annotation = annotation;
	}

	#sync(): readonly ModelCatalogItem[] {
		const catalog = this.#catalog();
		const previousIndex = this.#matches[this.#selected];
		const previousSelection =
			previousIndex === undefined ? undefined : this.#snapshot[previousIndex];
		const changed =
			catalog.length !== this.#snapshot.length ||
			catalog.some((item, index) => {
				const previous = this.#snapshot[index];
				return (
					previous === undefined ||
					item.provider !== previous.provider ||
					item.id !== previous.id ||
					item.name !== previous.name
				);
			});
		if (changed) {
			this.#snapshot = catalog.map((item) => ({
				provider: item.provider,
				id: item.id,
				name: item.name,
				searchable: `${clean(item.provider)}/${clean(item.id)}\n${clean(item.name)}`.toLowerCase(),
			}));
		}
		const query = this.#input.getValue().trim().toLowerCase();
		if (changed || query !== this.#query) {
			if (query !== this.#query) this.#selected = 0;
			this.#matches = [];
			for (const [index, item] of this.#snapshot.entries()) {
				if (!query || item.searchable.includes(query)) this.#matches.push(index);
			}
			if (changed && query === this.#query && previousSelection) {
				const position = this.#matches.findIndex((index) => {
					const item = this.#snapshot[index];
					return item?.provider === previousSelection.provider && item.id === previousSelection.id;
				});
				if (position >= 0) this.#selected = position;
			}
			this.#query = query;
			this.#selected = Math.max(0, Math.min(this.#selected, this.#matches.length - 1));
		}
		return catalog;
	}

	/** Returns the current matching item, including the latest catalog object. */
	selected(): ModelCatalogItem | undefined {
		const catalog = this.#sync();
		const index = this.#matches[this.#selected];
		return index === undefined ? undefined : catalog[index];
	}

	/** Intercept owner keys such as h/v before handleInput only while this returns false. */
	isEditing(): boolean {
		return this.#editing;
	}

	/** Owners can distinguish the scrollable selection detail from the results list. */
	isInspecting(): boolean {
		return this.#inspecting;
	}

	/** Move the selected result for owner-specific navigation shortcuts. */
	moveSelection(delta: number): void {
		this.#sync();
		this.#selected = Math.max(0, Math.min(this.#matches.length - 1, this.#selected + delta));
		this.#editing = false;
		this.#input.focused = false;
	}

	#search(data?: string): void {
		this.#editing = true;
		this.#input.focused = true;
		if (data !== undefined) {
			if (data.includes("\x1b[200~")) this.#pasting = true;
			if (data.includes("\x1b[201~")) this.#pasting = false;
			this.#input.handleInput(data);
		}
		const value = this.#input.getValue();
		const safe = clean(value);
		if (safe !== value) this.#input.setValue(safe);
	}

	/** Consumes modal keys; navigation or Tab leaves search, and Escape unwinds detail/search/owner. */
	handleInput(data: string): boolean {
		const printable = decodeKittyPrintable(data) ?? data;
		if (
			this.#editing &&
			(this.#pasting ||
				data.startsWith("\x1b[200~") ||
				(printable !== "" && !/[\p{Cc}]/u.test(printable)))
		) {
			this.#search(data);
			return true;
		}
		const { keys } = this.#host;
		const cancel = keys.matches(data, "tui.select.cancel");
		const confirm = keys.matches(data, "tui.select.confirm");
		const up = keys.matches(data, "tui.select.up");
		const down = keys.matches(data, "tui.select.down");
		const pageUp =
			keys.matches(data, "tui.select.pageUp") || (!up && !down && matchesKey(data, "alt+up"));
		const pageDown =
			keys.matches(data, "tui.select.pageDown") || (!up && !down && matchesKey(data, "alt+down"));
		if (cancel) {
			if (this.#inspecting) {
				this.#inspecting = false;
			} else if (this.#editing || this.#input.getValue()) {
				this.#input.setValue("");
				this.#input.focused = false;
				this.#editing = false;
			} else this.#cancel();
			return true;
		}
		if (confirm) {
			const item = this.selected();
			if (item) this.#choose(item);
			return true;
		}
		if (this.#editing && keys.matches(data, "tui.input.tab")) {
			this.#editing = false;
			this.#input.focused = false;
			return true;
		}
		if (up || down || pageUp || pageDown) {
			if (this.#inspecting) {
				const delta = (up || pageUp ? -1 : 1) * (pageUp || pageDown ? this.#detailPageSize : 1);
				this.#detailOffset = Math.max(
					0,
					Math.min(this.#detailMaxOffset, this.#detailOffset + delta),
				);
			} else {
				const delta = (up || pageUp ? -1 : 1) * (pageUp || pageDown ? this.#pageSize : 1);
				this.moveSelection(delta);
			}
			return true;
		}
		if (this.#inspecting) {
			if (data === "?" || decodeKittyPrintable(data) === "?") this.#inspecting = false;
			return true;
		}
		if (this.#editing) {
			this.#search(data);
			return true;
		}
		if (printable === "?") {
			if (this.selected()) {
				this.#inspecting = true;
				this.#detailOffset = 0;
			}
			return true;
		}
		if (printable === "/") {
			this.#search();
			return true;
		}
		if (data.startsWith("\x1b[200~") || (printable !== "" && !/[\p{Cc}]/u.test(printable))) {
			this.#search(data);
			return true;
		}
		return true;
	}

	/** Returns a shrink-wrapped body, with filtered range and binding-aware key hints. */
	render(width: number, bodyRows: number): TabBody {
		const catalog = this.#sync();
		const { theme } = this.#host;
		const binding = (id: Parameters<TabViewHost["binding"]>[0]) => clean(this.#host.binding(id));
		const hintAvailable = (id: Parameters<TabViewHost["binding"]>[0]) => {
			const key = this.#host.keys.getKeys(id)[0];
			if (key === undefined) return false;
			if (!this.#editing) return true;
			const base = key.startsWith("shift+") ? key.slice(6) : key;
			return base !== "space" && base.length !== 1;
		};
		const index = this.#matches[this.#selected];
		const item = index === undefined ? undefined : catalog[index];
		const annotation = item && index !== undefined ? this.#annotation?.(item, index) : undefined;
		const status = annotation ? `${clean(annotation)} · ` : "";
		const columns = Math.max(0, width);
		const height = Math.max(0, bodyRows);
		const identity = item ? `${clean(item.provider)}/${clean(item.id)}` : undefined;
		const altUp = "\x1b[1;3A";
		const altDown = "\x1b[1;3B";
		const altPageAvailable =
			!this.#host.keys.matches(altUp, "tui.select.up") &&
			!this.#host.keys.matches(altUp, "tui.select.down") &&
			!this.#host.keys.matches(altDown, "tui.select.up") &&
			!this.#host.keys.matches(altDown, "tui.select.down");
		const descriptionText = this.#inspecting
			? "Scroll for the full identity and name."
			: this.#editing
				? hintAvailable("tui.input.tab")
					? `? inspect after ${binding("tui.input.tab")} or moving`
					: "? inspect after moving"
				: "? inspect · alt+↑/↓ page · / search";
		const description = truncateToWidth(theme.fg("muted", descriptionText), columns, "…");
		const fullDescriptionText = [
			this.#inspecting
				? "Selection inspection: ? returns to results; use navigation to read the full identity and name."
				: this.#editing
					? `Search models by provider/ID or name. ${descriptionText}.`
					: `Model results. ${descriptionText}.`,
			...(identity ? [`Selected model identity: ${identity}.`] : []),
			...(item ? [`Name: ${clean(item.name)}.`] : []),
			...(item?.aliasSource !== undefined
				? [`Alias source: ${clean(item.provider)}/${clean(item.aliasSource)}.`]
				: []),
		].join(" ");
		const fullDescription = theme.fg("muted", sanitize(fullDescriptionText));
		const hints = [
			...(hintAvailable("tui.select.up") && hintAvailable("tui.select.down")
				? [
						{
							key: `${binding("tui.select.up")}/${binding("tui.select.down")}`,
							action: "move",
							priority: 1,
						},
					]
				: []),
			...(hintAvailable("tui.select.pageUp") && hintAvailable("tui.select.pageDown")
				? [
						{
							key: `${binding("tui.select.pageUp")}/${binding("tui.select.pageDown")}`,
							action: "page",
							priority: 2,
						},
					]
				: []),
			{ key: "alt+↑/↓", action: "page", priority: 2 },
			...(hintAvailable("tui.select.confirm")
				? [{ key: binding("tui.select.confirm"), action: "choose", priority: 0 }]
				: []),
			...(hintAvailable("tui.select.cancel")
				? [{ key: binding("tui.select.cancel"), action: "back", priority: 0 }]
				: []),
			...(this.#editing && hintAvailable("tui.input.tab")
				? [{ key: binding("tui.input.tab"), action: "results", priority: 1 }]
				: []),
			...(!this.#inspecting && !this.#editing
				? [
						{ key: "/", action: "search", priority: 1 },
						{ key: "?", action: "inspect", priority: 1 },
					]
				: []),
		];
		if (this.#inspecting && item) {
			const detail = [
				"Identity",
				...wrapIdentity(`${clean(item.provider)}/${clean(item.id)}`, Math.max(1, columns)),
				"Name",
				...wrapIdentity(clean(item.name), Math.max(1, columns)),
			];
			this.#detailPageSize = Math.max(1, height);
			this.#detailMaxOffset = Math.max(0, detail.length - height);
			this.#detailOffset = Math.min(this.#detailOffset, this.#detailMaxOffset);
			return {
				lines: detail
					.slice(this.#detailOffset, this.#detailOffset + height)
					.map((line) => truncateToWidth(line, columns, "…")),
				above: this.#detailOffset,
				below: Math.max(0, detail.length - this.#detailOffset - height),
				modal: true,
				state: truncateToWidth(theme.fg("dim", `${status}Selection detail`), columns, "…"),
				description,
				fullDescription,
				hints,
				fullHints: [
					...hints.filter(
						(hint) =>
							(hint.action !== "choose" || item !== undefined) &&
							(hint.key !== "alt+↑/↓" || altPageAvailable),
					),
					...(this.#inspecting ? [{ key: "?", action: "results", priority: 1 }] : []),
				],
			};
		}
		this.#inspecting = false;
		const showSearch = height > 1 || this.#editing;
		const available = Math.max(0, height - (showSearch ? 1 : 0));
		this.#pageSize = Math.max(1, available);
		const start = Math.floor(this.#selected / this.#pageSize) * this.#pageSize;
		const end = Math.min(start + available, this.#matches.length);
		const lines: string[] = [];
		if (showSearch && height > 0) {
			const prefix = ` ${theme.fg("muted", "⌕")} `;
			const space = Math.max(0, columns - visibleWidth(prefix));
			const field = this.#editing
				? (this.#input.render(space)[0] ?? "")
				: this.#input.getValue() || "provider/id or name";
			lines.push(truncateToWidth(prefix + field, columns, "…"));
		}
		for (let position = start; position < end; position++) {
			const modelIndex = this.#matches[position];
			const model = modelIndex === undefined ? undefined : catalog[modelIndex];
			if (!model) continue;
			const marker = position === this.#selected ? theme.fg("accent", "❯") : " ";
			const annotation =
				modelIndex === undefined ? undefined : this.#annotation?.(model, modelIndex);
			lines.push(
				truncateToWidth(
					` ${marker} ${annotation ? `${clean(annotation)} ` : ""}${clean(model.provider)}/${clean(model.id)} · ${clean(model.name)}`,
					columns,
					"…",
				),
			);
		}
		if (this.#matches.length === 0 && available > 0)
			lines.push(truncateToWidth(" No models match. Search by ID or name.", columns, "…"));
		const count = this.#matches.length;
		const range =
			count === 0 ? "0 results" : `${available ? start + 1 : 0}–${available ? end : 0} of ${count}`;
		return {
			lines,
			above: count ? start : 0,
			below: Math.max(0, count - end),
			modal: true,
			state: truncateToWidth(theme.fg("dim", `${status}${range}`), columns, "…"),
			description,
			fullDescription,
			hints,
			fullHints: [
				...hints.filter(
					(hint) =>
						(hint.action !== "choose" || item !== undefined) &&
						(hint.key !== "alt+↑/↓" || altPageAvailable),
				),
				...(this.#inspecting ? [{ key: "?", action: "results", priority: 1 }] : []),
			],
		};
	}
}

/** Staged, typed edits to one model's user-scoped overrides. */
import {
	Input,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { OverrideEdit } from "../../models/overrides/index.ts";
import { type HintItem, sanitize } from "../frame/index.ts";
import { AliasDetail } from "./alias-detail.ts";
import type { ModelCatalogItem, ModelPresentation, ModelsTabDeps, RuleOutcome } from "./models.ts";
import type { TabBody, TabViewHost } from "./view.ts";

type Field = {
	label: string;
	path: readonly string[];
	kind: "name" | "integer" | "cost" | "boolean" | "input" | "verbosity";
	value: unknown;
};
type DetailPresentation = ModelPresentation & {
	outcome?: RuleOutcome;
	aliasSource?: string;
	winningRule?: string;
};
const clean = (value: string) => sanitize(value).replace(/\n/g, " ");
function at(value: unknown, path: readonly string[]): unknown {
	for (const key of path) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
		value = Object.hasOwn(value, key) ? Reflect.get(value, key) : undefined;
	}
	return value;
}

/** A detail subview; the owner disposes it when navigating back. */
export class ModelDetail {
	readonly #host: TabViewHost;
	readonly #deps: NonNullable<ModelsTabDeps["details"]>;
	readonly #item: ModelCatalogItem;
	readonly #back: () => void;
	readonly #presentation: (() => DetailPresentation) | undefined;
	readonly #input = new Input({ prompt: "", placeholder: "" });
	readonly #fields: Field[];
	#override: Record<string, unknown> | undefined;
	#changes = new Map<number, OverrideEdit>();
	#selected = 0;
	#offset = 0;
	#mode: "loading" | "list" | "edit" = "loading";
	#editInitial = "";
	#message = "";
	#saving = false;
	#unavailable = false;
	#disposed = false;
	#aliasDetail: AliasDetail | undefined;

	constructor(
		host: TabViewHost,
		deps: NonNullable<ModelsTabDeps["details"]>,
		item: ModelCatalogItem,
		back: () => void,
		presentation?: () => DetailPresentation,
	) {
		this.#host = host;
		this.#deps = deps;
		this.#item = item;
		this.#back = back;
		this.#presentation = presentation;
		this.#fields = [
			{ label: "Name", path: ["name"], kind: "name", value: item.name },
			{
				label: "Context window",
				path: ["contextWindow"],
				kind: "integer",
				value: item.contextWindow,
			},
			{ label: "Max tokens", path: ["maxTokens"], kind: "integer", value: item.maxTokens },
			{ label: "Reasoning", path: ["reasoning"], kind: "boolean", value: item.reasoning },
			{ label: "Input", path: ["input"], kind: "input", value: item.input },
			...(["input", "output", "cacheRead", "cacheWrite"] as const).map((key) => ({
				label: `Cost ${key}`,
				path: ["cost", key],
				kind: "cost" as const,
				value: item.cost?.[key],
			})),
		];
		if (item.api === "openai-responses" || item.api === "openai-codex-responses")
			this.#fields.push({
				label: "Response verbosity",
				path: ["samplingParams", "text", "verbosity"],
				kind: "verbosity",
				value: undefined,
			});
		void this.#load();
	}
	/** Include this model's staged fields and its nested alias editor. */
	hasDrafts(): boolean {
		return (
			this.#changes.size > 0 ||
			(this.#mode === "edit" && this.#input.getValue() !== this.#editInitial) ||
			(this.#aliasDetail?.hasDrafts() ?? false)
		);
	}

	/** Discard this model's drafts and its nested alias draft. */
	discardDrafts(): void {
		if (this.isSaving()) return;
		this.#changes.clear();
		this.#aliasDetail?.discardDrafts();
		if (this.#mode === "edit") this.#mode = "list";
		this.#input.setValue("");
		this.#message = "";
	}

	/** Include saves owned by the nested alias editor. */
	isSaving(): boolean {
		return this.#saving || (this.#aliasDetail?.isSaving() ?? false);
	}

	async #load(): Promise<void> {
		try {
			const override = await this.#deps.read(this.#item.provider, this.#item.id);
			if (this.#disposed) return;
			this.#override = override;
		} catch (error) {
			if (!this.#disposed) {
				this.#unavailable = true;
				this.#message = `Read failed; reopen to retry: ${error instanceof Error ? error.message : String(error)}`;
			}
		} finally {
			if (!this.#disposed) {
				this.#mode = "list";
				this.#host.refresh();
			}
		}
	}
	async #save(): Promise<void> {
		this.#saving = true;
		const changes = [...this.#changes].flatMap(([index, edit]) => {
			const field = this.#fields[index];
			return field ? [{ field: field.path, edit }] : [];
		});
		try {
			await this.#deps.save(this.#item.provider, this.#item.id, changes);
			if (this.#disposed) return;
			this.#changes.clear();
			try {
				const override = await this.#deps.read(this.#item.provider, this.#item.id);
				if (this.#disposed) return;
				this.#override = override;
				const current = this.#deps.current?.(this.#item.provider, this.#item.id);
				if (current) for (const field of this.#fields) field.value = at(current, field.path);
				if (!this.#disposed) this.#message = "Saved overrides";
			} catch (error) {
				if (!this.#disposed) {
					this.#unavailable = true;
					this.#message = `Saved; reload failed, reopen to retry: ${error instanceof Error ? error.message : String(error)}`;
				}
			}
		} catch (error) {
			if (!this.#disposed)
				this.#message = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			this.#saving = false;
			if (!this.#disposed) this.#host.refresh();
		}
	}
	#value(field: Field): unknown {
		const edit = this.#changes.get(this.#selected);
		if (edit?.kind === "set") return edit.value;
		if (edit?.kind === "remove") return undefined;
		return at(this.#override, field.path) ?? field.value;
	}
	#aliases() {
		return (
			this.#deps.aliases
				?.list()
				.filter(
					(alias) => alias.provider === this.#item.provider && alias.source === this.#item.id,
				) ?? []
		);
	}
	#aliasAvailable(): boolean {
		const aliases = this.#deps.aliases;
		return (
			!!aliases &&
			aliases.supported(this.#item.provider) &&
			!aliases
				.list()
				.some((alias) => alias.provider === this.#item.provider && alias.id === this.#item.id)
		);
	}
	/** Returns false only when Escape should return to the catalog. */
	handleInput(data: string): boolean {
		if (this.#aliasDetail) {
			if (!this.#aliasDetail.handleInput(data)) {
				this.#aliasDetail.dispose();
				this.#aliasDetail = undefined;
			}
			return true;
		}
		if (this.#saving || this.#mode === "loading") return true;
		const { keys } = this.#host;
		const cancel = keys.matches(data, "tui.select.cancel");
		const enter = keys.matches(data, "tui.select.confirm");
		const field = this.#fields[this.#selected];
		if (this.#mode === "edit" && field) {
			if (cancel) {
				this.#mode = "list";
				this.#message = "";
			} else if (enter) {
				const raw = this.#input.getValue();
				const numeric = Number(raw);
				if (field.kind === "name" && !raw.trim()) this.#message = "Name cannot be empty";
				else if (
					field.kind === "integer" &&
					(!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(numeric) || numeric <= 0)
				)
					this.#message = "Enter a positive integer";
				else if (
					field.kind === "cost" &&
					(!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()) ||
						!Number.isFinite(numeric))
				)
					this.#message = "Enter a non-negative cost";
				else {
					this.#changes.set(this.#selected, {
						kind: "set",
						value: field.kind === "name" ? raw : numeric,
					});
					this.#message = "";
					this.#mode = "list";
				}
			} else if (!matchesKey(data, "ctrl+s")) this.#input.handleInput(data);
			return true;
		}
		if (cancel) {
			if (!this.hasDrafts()) return false;
			if (!this.#host.confirmDiscard) {
				this.#message = "Cannot discard; save or keep editing";
				return true;
			}
			this.#host.confirmDiscard(() => {
				if (this.#disposed || this.isSaving()) return;
				this.discardDrafts();
				this.#back();
			});
			return true;
		}
		if (this.#unavailable) return true;
		if (matchesKey(data, "ctrl+s")) {
			if (this.#changes.size) void this.#save();
			else this.#message = "No staged changes to save";
			return true;
		}
		if (keys.matches(data, "tui.select.up") || data === "k") {
			this.#selected = Math.max(0, this.#selected - 1);
			return true;
		}
		if (keys.matches(data, "tui.select.down") || data === "j") {
			this.#selected = Math.min(
				this.#fields.length - 1 + (this.#aliasAvailable() ? this.#aliases().length + 1 : 0),
				this.#selected + 1,
			);
			return true;
		}
		if (!field) {
			const aliases = this.#deps.aliases;
			if (enter && aliases && this.#aliasAvailable()) {
				const original = this.#aliases()[this.#selected - this.#fields.length];
				this.#aliasDetail = new AliasDetail(
					this.#host,
					aliases,
					this.#item.provider,
					this.#item.id,
					original,
					(message) => {
						this.#aliasDetail?.dispose();
						this.#aliasDetail = undefined;
						this.#selected = Math.min(this.#selected, this.#fields.length + this.#aliases().length);
						if (message !== undefined) this.#message = message;
						if (!this.#disposed) this.#host.refresh();
					},
				);
			}
			return true;
		}
		if (matchesKey(data, "backspace") || data === "d") {
			this.#changes.set(this.#selected, { kind: "remove" });
			this.#message = "";
			return true;
		}
		const left = keys.matches(data, "tui.editor.cursorLeft") || data === "h";
		const right = keys.matches(data, "tui.editor.cursorRight") || data === "l";
		if (enter && (field.kind === "name" || field.kind === "integer" || field.kind === "cost")) {
			this.#input.setValue("");
			const value = this.#value(field);
			if (value !== undefined) this.#input.handleInput(`\x1b[200~${clean(String(value))}\x1b[201~`);
			this.#editInitial = this.#input.getValue();
			this.#input.focused = true;
			this.#mode = "edit";
			this.#message = "";
			return true;
		}
		if ((enter || data === " " || left || right) && field.kind === "boolean") {
			this.#changes.set(this.#selected, {
				kind: "set",
				value: left ? false : right ? true : !this.#value(field),
			});
		} else if ((enter || data === " " || left || right) && field.kind === "input") {
			const options = [["text"], ["text", "image"], ["image"]];
			const value = this.#value(field);
			const index = options.findIndex(
				(option) =>
					Array.isArray(value) &&
					option.length === value.length &&
					option.every((v) => value.includes(v)),
			);
			const next =
				options[(Math.max(index, 0) + (left ? -1 : 1) + options.length) % options.length];
			if (next) this.#changes.set(this.#selected, { kind: "set", value: next });
		} else if ((enter || data === " " || left || right) && field.kind === "verbosity") {
			const options = ["inherit", "low", "medium", "high"];
			const index = Math.max(0, options.indexOf(String(this.#value(field) ?? "inherit")));
			const next = options[(index + (left ? -1 : 1) + options.length) % options.length];
			if (next)
				this.#changes.set(
					this.#selected,
					next === "inherit" ? { kind: "remove" } : { kind: "set", value: next },
				);
		} else return true;
		this.#message = "";
		return true;
	}
	/** Render a scrollable body using the shared dashboard frame. */
	render(width: number, bodyRows: number): TabBody {
		if (this.#aliasDetail) return this.#aliasDetail.render(width, bodyRows);
		const { theme } = this.#host;
		const presentation = this.#presentation?.();
		const rows = [
			` ${clean(this.#item.provider)}/${clean(this.#item.id)}${this.#changes.size ? " · staged" : ""}`,
		];
		if (presentation?.outcome)
			rows.push(` Visibility · ${presentation.outcome.visible ? "listed" : "hidden"}`);
		if (presentation?.showProvenance && presentation.aliasSource !== undefined)
			rows.push(` Alias of · ${clean(this.#item.provider)}/${clean(presentation.aliasSource)}`);
		if (presentation?.showMatchedRule && presentation.outcome?.ruleIndex !== undefined)
			rows.push(` Matched rule · ${presentation.outcome.ruleIndex + 1}`);
		const headerRows = rows.length;
		for (const [index, field] of this.#fields.entries()) {
			const edit = this.#changes.get(index);
			const value =
				edit?.kind === "set"
					? edit.value
					: edit?.kind === "remove"
						? undefined
						: (at(this.#override, field.path) ?? field.value);
			const source =
				edit?.kind === "remove"
					? "inherit (staged)"
					: edit?.kind === "set"
						? presentation?.showProvenance
							? "override (staged)"
							: "staged"
						: presentation?.showProvenance && this.#mode !== "loading" && !this.#unavailable
							? at(this.#override, field.path) !== undefined
								? "override"
								: "default"
							: undefined;
			const marker = index === this.#selected ? theme.fg("accent", "❯") : " ";
			const prefix = ` ${marker} ${field.label} · `;
			let suffix = source ? ` · ${source}` : "";
			if (edit && visibleWidth(prefix + suffix) > width) suffix = " · staged";
			const display =
				index === this.#selected && this.#mode === "edit"
					? (this.#input.render(
							Math.max(0, width - visibleWidth(prefix) - visibleWidth(suffix)),
						)[0] ?? "")
					: clean(
							Array.isArray(value)
								? value.join(", ")
								: String(value ?? (field.kind === "verbosity" ? "inherit" : "unknown")),
						);
			rows.push(
				`${prefix}${truncateToWidth(display, Math.max(0, width - visibleWidth(prefix) - visibleWidth(suffix)), "…")}${suffix}`,
			);
		}
		rows.push(" Aliases");
		const aliases = this.#aliases();
		const availableAliases = this.#aliasAvailable();
		const aliasReason = !this.#deps.aliases
			? "Alias management is unavailable"
			: !this.#deps.aliases.supported(this.#item.provider)
				? "Aliases are not supported for this provider"
				: "Aliases require a physical source model";
		for (const [index, alias] of aliases.entries()) {
			rows.push(
				` ${availableAliases && this.#selected === this.#fields.length + index ? theme.fg("accent", "❯") : " "} ${clean(alias.id)}${alias.name ? ` · ${clean(alias.name)}` : ""}`,
			);
		}
		if (availableAliases) {
			rows.push(
				` ${this.#selected === this.#fields.length + aliases.length ? theme.fg("accent", "❯") : " "} + new alias`,
			);
		} else rows.push(` ${aliasReason}`);
		const details = this.#message
			? wrapTextWithAnsi(clean(this.#message), Math.max(1, width - 1)).map(
					(line) => ` ${theme.fg("warning", line)}`,
				)
			: this.#mode === "loading"
				? [" Loading overrides…"]
				: [];
		const reserved = Math.min(details.length, Math.max(0, bodyRows - 1));
		const available = Math.max(0, bodyRows - reserved);
		const selectedRow =
			this.#selected + headerRows + (this.#selected >= this.#fields.length ? 1 : 0);
		this.#offset = Math.max(0, Math.min(this.#offset, selectedRow));
		this.#offset = Math.max(this.#offset, selectedRow - available + 1);
		this.#offset = Math.max(0, Math.min(this.#offset, rows.length - available));
		const binding = (id: Parameters<TabViewHost["binding"]>[0]) => clean(this.#host.binding(id));
		const identity = `${clean(this.#item.provider)}/${clean(this.#item.id)}`;
		const fullDescriptionText = [
			`Selected model identity: ${identity}.`,
			`Name: ${clean(this.#item.name)}.`,
			...(presentation?.outcome
				? [`Visibility: ${presentation.outcome.visible ? "listed" : "hidden"}.`]
				: []),
			...(presentation?.aliasSource !== undefined
				? [`Alias source: ${clean(this.#item.provider)}/${clean(presentation.aliasSource)}.`]
				: []),
			...(presentation?.outcome?.ruleIndex !== undefined
				? [
						`Winning rule ${presentation.outcome.ruleIndex + 1}${
							presentation.winningRule === undefined ? "" : `: ${clean(presentation.winningRule)}`
						}.`,
					]
				: presentation?.outcome
					? ["No matching rule; models are listed by default."]
					: []),
			"Overrides are saved to user models.json.",
		].join(" ");
		const fullDescription = theme.fg("muted", sanitize(fullDescriptionText));
		const fullFeedback = this.#message ? [theme.fg("warning", sanitize(this.#message))] : [];
		const selectedField = this.#fields[this.#selected];
		const movementHint: HintItem = {
			key: `${binding("tui.select.up")}/${binding("tui.select.down")}`,
			action: "move",
			priority: 2,
		};
		const fullHints: HintItem[] =
			this.#saving || this.#mode === "loading"
				? []
				: this.#mode === "edit"
					? [
							{ key: binding("tui.select.confirm"), action: "stage", priority: 0 },
							{ key: binding("tui.select.cancel"), action: "cancel", priority: 0 },
						]
					: this.#unavailable
						? [{ key: binding("tui.select.cancel"), action: "back", priority: 0 }]
						: this.#selected >= this.#fields.length
							? [
									{ key: binding("tui.select.confirm"), action: "open alias", priority: 0 },
									movementHint,
									{ key: "ctrl+s", action: "save overrides", priority: 0 },
									{ key: binding("tui.select.cancel"), action: "discard/back", priority: 0 },
								]
							: [
									{
										key: binding("tui.select.confirm"),
										action:
											selectedField?.kind === "name" ||
											selectedField?.kind === "integer" ||
											selectedField?.kind === "cost"
												? "edit"
												: "change",
										priority: 0,
									},
									movementHint,
									...(selectedField &&
									["boolean", "input", "verbosity"].includes(selectedField.kind)
										? [
												{
													key: `${binding("tui.editor.cursorLeft")}/${binding("tui.editor.cursorRight")}`,
													action: "change",
													priority: 1,
												},
											]
										: []),
									{ key: "backspace/d", action: "inherit", priority: 1 },
									{ key: "ctrl+s", action: "save overrides", priority: 0 },
									{ key: binding("tui.select.cancel"), action: "discard/back", priority: 0 },
								];
		return {
			lines: [
				...rows.slice(this.#offset, this.#offset + available),
				...details.slice(0, reserved),
			].map((line) => truncateToWidth(line, Math.max(0, width), "…")),
			above: this.#offset,
			below: Math.max(0, rows.length - this.#offset - available),
			modal: true,
			state: truncateToWidth(
				theme.fg(
					"dim",
					`${presentation?.outcome ? `${presentation.outcome.visible ? "listed" : "hidden"} · ` : ""}${this.#changes.size ? "staged" : "model detail"}`,
				),
				Math.max(0, width),
				"…",
			),
			description: truncateToWidth(
				theme.fg(
					"muted",
					availableAliases ? "Overrides are saved to user models.json." : aliasReason,
				),
				Math.max(0, width - 1),
				"…",
			),
			fullDescription,
			fullFeedback,
			fullHints,
			hints:
				this.#mode === "edit"
					? [
							{ key: binding("tui.select.confirm"), action: "stage", priority: 0 },
							{ key: binding("tui.select.cancel"), action: "cancel", priority: 0 },
						]
					: this.#selected >= this.#fields.length
						? [
								{ key: binding("tui.select.confirm"), action: "open alias", priority: 0 },
								{ key: binding("tui.select.cancel"), action: "discard/back", priority: 0 },
							]
						: [
								{ key: binding("tui.select.confirm"), action: "edit", priority: 0 },
								{
									key: `${binding("tui.editor.cursorLeft")}/${binding("tui.editor.cursorRight")}`,
									action: "change",
									priority: 1,
								},
								{ key: "backspace", action: "inherit", priority: 1 },
								{ key: "ctrl+s", action: "save", priority: 0 },
								{ key: binding("tui.select.cancel"), action: "discard/back", priority: 0 },
							],
		};
	}
	/** Ignore late async results after navigation. */
	dispose(): void {
		this.#disposed = true;
		this.#aliasDetail?.dispose();
	}
}

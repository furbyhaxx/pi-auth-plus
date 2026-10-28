/** Staged, typed edits to one model's user-scoped overrides. */
import { Input, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { OverrideEdit } from "../../models/overrides/index.ts";
import { sanitize } from "../frame/index.ts";
import type { ModelCatalogItem, ModelsTabDeps } from "./models.ts";
import type { TabBody, TabViewHost } from "./view.ts";

type Field = {
	label: string;
	path: readonly string[];
	kind: "name" | "integer" | "cost" | "boolean" | "input" | "verbosity";
	value: unknown;
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
	readonly #input = new Input({ prompt: "", placeholder: "" });
	readonly #fields: Field[];
	#override: Record<string, unknown> | undefined;
	#changes = new Map<number, OverrideEdit>();
	#selected = 0;
	#offset = 0;
	#mode: "loading" | "list" | "edit" = "loading";
	#message = "";
	#saving = false;
	#unavailable = false;
	#disposed = false;

	constructor(
		host: TabViewHost,
		deps: NonNullable<ModelsTabDeps["details"]>,
		item: ModelCatalogItem,
	) {
		this.#host = host;
		this.#deps = deps;
		this.#item = item;
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
	async #load(): Promise<void> {
		try {
			this.#override = await this.#deps.read(this.#item.provider, this.#item.id);
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
				this.#override = await this.#deps.read(this.#item.provider, this.#item.id);
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
	/** Returns false only when Escape should return to the catalog. */
	handleInput(data: string): boolean {
		if (this.#saving || this.#mode === "loading") return true;
		const { keys } = this.#host;
		const cancel = keys.matches(data, "tui.select.cancel");
		const enter = keys.matches(data, "tui.select.confirm");
		const field = this.#fields[this.#selected];
		if (!field) return true;
		if (this.#mode === "edit") {
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
		if (cancel) return false;
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
			this.#selected = Math.min(this.#fields.length - 1, this.#selected + 1);
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
		const { theme } = this.#host;
		const rows = [
			` ${clean(this.#item.provider)}/${clean(this.#item.id)}${this.#changes.size ? " · staged" : ""}`,
		];
		for (const [index, field] of this.#fields.entries()) {
			const edit = this.#changes.get(index);
			const value =
				edit?.kind === "set"
					? edit.value
					: edit?.kind === "remove"
						? undefined
						: (at(this.#override, field.path) ?? field.value);
			const display =
				index === this.#selected && this.#mode === "edit"
					? (this.#input.render(Math.max(1, width - 5))[0] ?? "")
					: clean(
							Array.isArray(value)
								? value.join(", ")
								: String(value ?? (field.kind === "verbosity" ? "inherit" : "unknown")),
						);
			const source =
				edit?.kind === "remove"
					? "inherit (staged)"
					: edit?.kind === "set"
						? "override (staged)"
						: at(this.#override, field.path) !== undefined
							? "override"
							: "default";
			rows.push(
				` ${index === this.#selected ? theme.fg("accent", "❯") : " "} ${field.label} · ${display} · ${source}`,
			);
		}
		const details = this.#message
			? [` ${theme.fg("warning", clean(this.#message))}`]
			: this.#mode === "loading"
				? [" Loading overrides…"]
				: [];
		const reserved = Math.min(details.length, Math.max(0, bodyRows - 1));
		const available = Math.max(0, bodyRows - reserved);
		const selectedRow = this.#selected + 1;
		this.#offset = Math.max(0, Math.min(this.#offset, selectedRow));
		this.#offset = Math.max(this.#offset, selectedRow - available + 1);
		this.#offset = Math.max(0, Math.min(this.#offset, rows.length - available));
		const binding = (id: Parameters<TabViewHost["binding"]>[0]) => this.#host.binding(id);
		return {
			lines: [
				...rows.slice(this.#offset, this.#offset + available),
				...details.slice(0, reserved),
			].map((line) => truncateToWidth(line, Math.max(0, width), "…")),
			above: this.#offset,
			below: Math.max(0, rows.length - this.#offset - available),
			modal: true,
			state: truncateToWidth(
				theme.fg("dim", this.#changes.size ? "staged" : "model detail"),
				Math.max(0, width),
				"…",
			),
			description: truncateToWidth(
				theme.fg("muted", "Overrides are saved to user models.json."),
				Math.max(0, width - 1),
				"…",
			),
			hints:
				this.#mode === "edit"
					? [
							{ key: binding("tui.select.confirm"), action: "stage", priority: 0 },
							{ key: binding("tui.select.cancel"), action: "cancel", priority: 0 },
						]
					: [
							{ key: binding("tui.select.confirm"), action: "edit", priority: 0 },
							{ key: "←/→", action: "change", priority: 1 },
							{ key: "backspace", action: "inherit", priority: 1 },
							{ key: "ctrl+s", action: "save", priority: 0 },
							{ key: binding("tui.select.cancel"), action: "discard/back", priority: 0 },
						],
		};
	}
	/** Ignore late async results after navigation. */
	dispose(): void {
		this.#disposed = true;
	}
}

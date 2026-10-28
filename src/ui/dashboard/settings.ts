/** Catalog-backed settings editing and scoped, staged saves for the dashboard. */
import { Input, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type AppSettings, SETTINGS } from "../../core/config/catalog.ts";
import type { Field, FieldValue, SaveScope } from "../../core/config/index.ts";
import { padTo, sanitize } from "../frame/index.ts";
import type { TabBody, TabView, TabViewHost } from "./view.ts";

/** Services owned by the command and the current session. */
export interface SettingsTabDeps {
	store(): AppSettings;
	onSaved(keys: readonly string[], scope: SaveScope): void;
	previewTemplate?(
		source: string,
		width: number,
	): { rows: readonly string[]; unknown: readonly string[] };
}

type SettingKey = keyof typeof SETTINGS;
const settingKeys = Object.keys(SETTINGS).filter((key): key is SettingKey => key in SETTINGS);

/** Edits the whole catalog without writing until the user chooses a save scope. */
export class SettingsView implements TabView {
	readonly #host: TabViewHost;
	readonly #deps: SettingsTabDeps;
	#selected = 0;
	#offset = 0;
	#previewOffset = 0;
	#staged: Record<string, FieldValue | null> = {};
	#mode: "list" | "edit" | "save" = "list";
	readonly #input = new Input({ prompt: "", placeholder: "" });
	#message = "";
	#saving = false;
	#disposed = false;

	constructor(host: TabViewHost, deps: SettingsTabDeps, select?: string) {
		this.#host = host;
		this.#deps = deps;
		if (select !== undefined && Object.hasOwn(SETTINGS, select)) {
			this.#selected = settingKeys.indexOf(select as SettingKey);
		}
	}

	dispose(): void {
		this.#disposed = true;
	}

	#value(key: SettingKey): FieldValue {
		const staged = this.#staged[key];
		return staged === null ? SETTINGS[key].default : (staged ?? this.#deps.store().get(key));
	}

	#stage(key: SettingKey, raw: unknown): boolean {
		const parsed = SETTINGS[key].parse(raw);
		if (parsed === undefined) {
			this.#message = `Invalid value for ${SETTINGS[key].label}; edit and retry`;
			return false;
		}
		this.#staged[key] = parsed;
		this.#message = "";
		return true;
	}

	async #save(scope: SaveScope): Promise<void> {
		this.#saving = true;
		this.#host.refresh();
		const keys = settingKeys.filter((key) => key in this.#staged);
		try {
			const store = this.#deps.store();
			await store.save(scope, this.#staged);
			if (this.#disposed) return;
			const hidden = store.shadowed(scope, keys);
			this.#staged = {};
			this.#message =
				hidden.length > 0
					? `Saved to ${scope}; ⚠ shadowed by higher scope: ${hidden.join(", ")}`
					: `Saved to ${scope} scope`;
			this.#deps.onSaved(keys, scope);
		} catch (error) {
			if (!this.#disposed) this.#message = error instanceof Error ? error.message : String(error);
		} finally {
			this.#saving = false;
			this.#mode = "list";
			if (!this.#disposed) this.#host.refresh();
		}
	}

	handleInput(data: string): boolean {
		if (this.#saving) return true;
		const { keys } = this.#host;
		const key = settingKeys[this.#selected];
		if (key === undefined) return false;
		const field: Field<FieldValue> = SETTINGS[key];
		const cancel = keys.matches(data, "tui.select.cancel");
		const enter = keys.matches(data, "tui.select.confirm");
		if (this.#mode === "edit") {
			if (cancel) {
				this.#mode = "list";
				this.#message = "";
			} else if (enter) {
				const raw = this.#input.getValue();
				if (this.#stage(key, field.kind === "number" ? (raw.trim() ? Number(raw) : NaN) : raw)) {
					this.#mode = "list";
				}
			} else this.#input.handleInput(data);
			return true;
		}
		if (this.#mode === "save") {
			if (cancel) this.#mode = "list";
			else if (data === "u") void this.#save("user");
			else if (data === "p") void this.#save("project");
			else if (data === "r") void this.#save("runtime");
			return true;
		}
		if (cancel) {
			if (Object.keys(this.#staged).length === 0) return false;
			this.#staged = {};
			this.#message = "Discarded staged changes";
			return true;
		}
		if (key === "quotas.lineTemplate" && this.#deps.previewTemplate) {
			const pageUp =
				keys.matches(data, "tui.select.pageUp") || keys.matches(data, "tui.editor.pageUp");
			const pageDown =
				keys.matches(data, "tui.select.pageDown") || keys.matches(data, "tui.editor.pageDown");
			if (pageUp || pageDown) {
				this.#previewOffset = Math.max(0, this.#previewOffset + (pageUp ? -1 : 1));
				return true;
			}
		}
		if (matchesKey(data, "ctrl+s")) {
			if (Object.keys(this.#staged).length > 0) this.#mode = "save";
			else this.#message = "No staged changes to save";
			return true;
		}
		const up = keys.matches(data, "tui.select.up") || data === "k";
		const down = keys.matches(data, "tui.select.down") || data === "j";
		if (up || down) {
			this.#selected = (this.#selected + (up ? -1 : 1) + settingKeys.length) % settingKeys.length;
			return true;
		}
		if (matchesKey(data, "backspace")) {
			this.#staged[key] = null;
			this.#message = "";
			return true;
		}
		const left = keys.matches(data, "tui.editor.cursorLeft") || data === "h";
		const right = keys.matches(data, "tui.editor.cursorRight") || data === "l";
		const activate = enter || data === " ";
		const value = this.#value(key);
		if (enter && (field.kind === "list" || field.kind === "rules")) {
			if (Object.keys(this.#staged).length > 0)
				this.#message = "Save or discard staged edits before opening editor";
			else this.#host.finish({ editSetting: key });
			return true;
		}
		if (enter && (field.kind === "string" || field.kind === "number")) {
			this.#mode = "edit";
			this.#input.setValue("");
			this.#input.handleInput(`\x1b[200~${sanitize(String(value))}\x1b[201~`);
			this.#input.focused = true;
			this.#message = "";
			return true;
		}
		if (!(left || right || activate)) return false;
		if (field.kind === "boolean") this.#stage(key, left ? false : right ? true : !value);
		else if (field.kind === "enum" && field.options) {
			const index = Math.max(
				0,
				field.options.findIndex((option) => option.value === value),
			);
			const option =
				field.options[(index + (left ? -1 : 1) + field.options.length) % field.options.length];
			if (option) this.#stage(key, option.value);
		} else if (field.kind === "number" && typeof value === "number") {
			this.#stage(key, value + (left ? -1 : 1) * (field.step ?? 1));
		} else return false;
		return true;
	}

	render(width: number, bodyRows: number): TabBody {
		const { theme } = this.#host;
		const binding = (id: Parameters<TabViewHost["binding"]>[0]) => this.#host.binding(id);
		const selected = settingKeys[this.#selected];
		const rows: string[] = [];
		let section = "";
		let selectedRow = 0;
		const labelWidth = Math.min(28, Math.max(8, Math.floor(width * 0.38)));
		for (const key of settingKeys) {
			const prefix = key.split(".")[0] ?? "";
			if (prefix !== section) {
				section = prefix;
				rows.push(` ${theme.bold(prefix.charAt(0).toUpperCase() + prefix.slice(1))}`);
			}
			const active = key === selected;
			if (active) selectedRow = rows.length;
			const field: Field<FieldValue> = SETTINGS[key];
			const value = this.#value(key);
			const source = key in this.#staged ? "● staged" : this.#deps.store().sourceOf(key);
			const valueWidth = Math.max(1, width - labelWidth - visibleWidth(source) - 6);
			let text =
				typeof value === "boolean"
					? value
						? "on"
						: "off"
					: (field.options?.find((option) => option.value === value)?.label ??
						(Array.isArray(value) ? JSON.stringify(value) : String(value)));
			text = sanitize(text);
			const rendered =
				active && this.#mode === "edit"
					? (this.#input.render(valueWidth)[0] ?? "")
					: truncateToWidth(text, valueWidth, "…");
			rows.push(
				` ${active ? theme.fg("accent", "❯") : " "} ${padTo(field.label, labelWidth)} ${padTo(rendered, valueWidth)} ${theme.fg(key in this.#staged ? "warning" : "dim", source)}`,
			);
		}
		const details: string[] = [];
		if (this.#message) details.push(` ${theme.fg("warning", sanitize(this.#message))}`);
		if (this.#mode === "save") details.push(" Save: u user · p project · r session");
		if (selected === "quotas.lineTemplate" && this.#deps.previewTemplate) {
			const source = this.#mode === "edit" ? this.#input.getValue() : String(this.#value(selected));
			const preview = this.#deps.previewTemplate(source, Math.max(1, width - 1));
			if (preview.unknown.length > 0)
				details.push(` ⚠ ignored: ${sanitize(preview.unknown.join(" "))}`);
			this.#previewOffset = Math.min(this.#previewOffset, Math.max(0, preview.rows.length - 1));
			if (preview.rows.length > 0) {
				details.push(
					` preview ${this.#previewOffset + 1}/${preview.rows.length} ${binding("tui.select.pageUp")}/${binding("tui.select.pageDown")}`,
				);
				details.push(` ${sanitize(preview.rows[this.#previewOffset] ?? "")}`);
			}
		}
		const reserved = Math.min(details.length, Math.max(0, bodyRows - 1));
		const available = Math.max(1, bodyRows - reserved);
		this.#offset = Math.min(this.#offset, selectedRow);
		this.#offset = Math.max(this.#offset, selectedRow - available + 1);
		this.#offset = Math.min(this.#offset, Math.max(0, rows.length - available));
		const field = selected === undefined ? undefined : SETTINGS[selected];
		const blocked =
			(field?.kind === "rules" || field?.kind === "list") && Object.keys(this.#staged).length > 0;
		return {
			lines: [...rows.slice(this.#offset, this.#offset + available), ...details.slice(0, reserved)]
				.slice(0, bodyRows)
				.map((line) => truncateToWidth(line, width, "…")),
			above: this.#offset,
			below: Math.max(0, rows.length - this.#offset - available),
			description: truncateToWidth(
				theme.fg("muted", sanitize(field?.description ?? "")),
				Math.max(1, width - 1),
				"…",
			),
			modal: this.#mode !== "list",
			hints:
				this.#mode === "edit"
					? [
							{ key: binding("tui.select.confirm"), action: "stage", priority: 0 },
							{ key: binding("tui.select.cancel"), action: "cancel edit", priority: 0 },
						]
					: this.#mode === "save"
						? [
								{ key: "u", action: "user", priority: 0 },
								{ key: "p", action: "project", priority: 0 },
								{ key: "r", action: "session", priority: 0 },
								{ key: binding("tui.select.cancel"), action: "cancel", priority: 1 },
							]
						: [
								{
									key: binding("tui.select.confirm"),
									action: blocked ? "save/discard edits first" : "edit",
									priority: 1,
								},
								{ key: "ctrl+s", action: "save", priority: 1 },
								{ key: "Backspace", action: "default", priority: 3 },
								{
									key: `${binding("tui.select.up")}/${binding("tui.select.down")}`,
									action: "move",
									priority: 2,
								},
								{
									key: `${binding("tui.editor.cursorLeft")}/${binding("tui.editor.cursorRight")}`,
									action: "change",
									priority: 2,
								},
							],
		};
	}
}

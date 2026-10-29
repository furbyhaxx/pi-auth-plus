/** Catalog-backed settings editing and scoped, staged saves for the dashboard. */
import {
	Input,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { type AppSettings, SETTINGS } from "../../core/config/catalog.ts";
import type { Field, FieldValue, SaveScope } from "../../core/config/index.ts";
import { formatSaveOutcome, type SettingsSaver } from "../../core/config/save.ts";
import { padTo, sanitize } from "../frame/index.ts";
import type { TabBody, TabView, TabViewHost } from "./view.ts";

/** Services owned by the command and the current session. */
export interface SettingsTabDeps {
	store(): AppSettings;
	readonly save: SettingsSaver;
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
	#saveReturnMode: "list" | "edit" = "list";
	#saveChanges: Record<string, FieldValue | null> = {};
	readonly #input = new Input({ prompt: "", placeholder: "" });
	#editInitial = "";
	#message = "";
	#messageOffset = 0;
	#messageRows = 0;
	#messageCapacity = 0;
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

	isSaving(): boolean {
		return this.#saving;
	}

	hasDrafts(): boolean {
		const editing =
			this.#mode === "edit" || (this.#mode === "save" && this.#saveReturnMode === "edit");
		return (
			Object.keys(this.#staged).length > 0 ||
			(editing && this.#input.getValue() !== this.#editInitial)
		);
	}

	discardDrafts(): void {
		if (this.#saving) return;
		this.#staged = {};
		this.#saveChanges = {};
		this.#mode = "list";
		this.#input.setValue("");
		this.#setMessage("");
	}

	#setMessage(message: string): void {
		this.#message = message;
		this.#messageOffset = 0;
		this.#messageRows = 0;
		this.#messageCapacity = 0;
	}

	#value(key: SettingKey): FieldValue {
		const staged = this.#staged[key];
		return staged === null ? SETTINGS[key].default : (staged ?? this.#deps.store().get(key));
	}

	#stage(key: SettingKey, raw: unknown): boolean {
		const parsed = SETTINGS[key].parse(raw);
		if (parsed === undefined) {
			this.#setMessage(`Invalid value for ${SETTINGS[key].label}; edit and retry`);
			return false;
		}
		this.#staged[key] = parsed;
		this.#setMessage("");
		return true;
	}

	#beginSave(key: SettingKey, field: Field<FieldValue>): void {
		const changes = { ...this.#staged };
		if (this.#mode === "edit" && this.#input.getValue() !== this.#editInitial) {
			const raw = this.#input.getValue();
			const parsed = field.parse(field.kind === "number" ? (raw.trim() ? Number(raw) : NaN) : raw);
			if (parsed === undefined) {
				this.#setMessage(`Invalid value for ${field.label}; edit and retry`);
				return;
			}
			changes[key] = parsed;
		}
		if (Object.keys(changes).length === 0) {
			this.#setMessage("No staged changes to save");
			return;
		}
		this.#saveReturnMode = this.#mode === "edit" ? "edit" : "list";
		this.#saveChanges = changes;
		this.#mode = "save";
		this.#setMessage("");
	}

	#allowsScope(scope: SaveScope): boolean {
		return settingKeys.every((key) => {
			const value = this.#saveChanges[key];
			const field: Field<FieldValue> = SETTINGS[key];
			return (
				value === undefined || value === null || (field.allowedScopes?.includes(scope) ?? true)
			);
		});
	}

	async #save(scope: SaveScope): Promise<void> {
		this.#saving = true;
		this.#host.refresh();
		try {
			const outcome = await this.#deps.save(scope, this.#saveChanges);
			if (this.#disposed) return;
			this.#setMessage(formatSaveOutcome(outcome));
			if (outcome.committed) {
				this.#staged = {};
				this.#saveChanges = {};
				this.#mode = "list";
			} else this.#mode = this.#saveReturnMode;
		} catch (error) {
			if (!this.#disposed) {
				this.#setMessage(error instanceof Error ? error.message : String(error));
				this.#mode = this.#saveReturnMode;
			}
		} finally {
			this.#saving = false;
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
		const pageUp =
			keys.matches(data, "tui.select.pageUp") || keys.matches(data, "tui.editor.pageUp");
		const pageDown =
			keys.matches(data, "tui.select.pageDown") || keys.matches(data, "tui.editor.pageDown");
		if ((pageUp || pageDown) && this.#messageRows > this.#messageCapacity) {
			const step = Math.max(1, this.#messageCapacity - 1);
			this.#messageOffset = Math.max(
				0,
				Math.min(
					this.#messageRows - this.#messageCapacity,
					this.#messageOffset + (pageUp ? -step : step),
				),
			);
			return true;
		}
		if (this.#mode !== "save" && matchesKey(data, "ctrl+s")) {
			this.#beginSave(key, field);
			return true;
		}
		if (this.#mode === "edit") {
			if (cancel) {
				this.#mode = "list";
				this.#setMessage("");
			} else if (enter) {
				const raw = this.#input.getValue();
				if (this.#stage(key, field.kind === "number" ? (raw.trim() ? Number(raw) : NaN) : raw)) {
					this.#mode = "list";
				}
			} else this.#input.handleInput(data);
			return true;
		}
		if (this.#mode === "save") {
			if (cancel) this.#mode = this.#saveReturnMode;
			else {
				const scope =
					data === "u" ? "user" : data === "p" ? "project" : data === "r" ? "runtime" : undefined;
				if (scope && this.#allowsScope(scope)) void this.#save(scope);
			}
			return true;
		}
		if (cancel) return false;
		if (key === "quotas.lineTemplate" && this.#deps.previewTemplate) {
			if (pageUp || pageDown) {
				this.#previewOffset = Math.max(0, this.#previewOffset + (pageUp ? -1 : 1));
				return true;
			}
		}
		const up = keys.matches(data, "tui.select.up") || data === "k";
		const down = keys.matches(data, "tui.select.down") || data === "j";
		if (up || down) {
			this.#selected = (this.#selected + (up ? -1 : 1) + settingKeys.length) % settingKeys.length;
			return true;
		}
		if (matchesKey(data, "backspace")) {
			this.#staged[key] = null;
			this.#setMessage("");
			return true;
		}
		const left = keys.matches(data, "tui.editor.cursorLeft") || data === "h";
		const right = keys.matches(data, "tui.editor.cursorRight") || data === "l";
		const activate = enter || data === " ";
		const value = this.#value(key);
		if (enter && (field.kind === "list" || field.kind === "rules")) {
			if (Object.keys(this.#staged).length > 0)
				this.#setMessage("Save or discard staged edits before opening editor");
			else this.#host.finish({ editSetting: key });
			return true;
		}
		if (enter && (field.kind === "string" || field.kind === "number")) {
			this.#mode = "edit";
			this.#input.setValue("");
			this.#input.handleInput(`\x1b[200~${sanitize(String(value))}\x1b[201~`);
			this.#input.focused = true;
			this.#editInitial = this.#input.getValue();
			this.#setMessage("");
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
		const messageLines = this.#message
			? wrapTextWithAnsi(sanitize(this.#message), Math.max(1, width - 1))
			: [];
		const maxDetails = Math.max(0, bodyRows - 1);
		this.#messageRows = messageLines.length;
		this.#messageCapacity =
			messageLines.length > maxDetails ? Math.max(1, maxDetails - 1) : maxDetails;
		this.#messageOffset = Math.min(
			this.#messageOffset,
			Math.max(0, messageLines.length - this.#messageCapacity),
		);
		for (const line of messageLines.slice(
			this.#messageOffset,
			this.#messageOffset + this.#messageCapacity,
		))
			details.push(` ${theme.fg("warning", line)}`);
		if (messageLines.length > this.#messageCapacity)
			details.push(
				` result ${this.#messageOffset + 1}-${Math.min(messageLines.length, this.#messageOffset + this.#messageCapacity)}/${messageLines.length} ${binding("tui.select.pageUp")}/${binding("tui.select.pageDown")}`,
			);
		if (this.#mode === "save") {
			const scopes = [
				this.#allowsScope("user") && "u user",
				this.#allowsScope("project") && "p project",
				this.#allowsScope("runtime") && "r session",
			].filter(Boolean);
			details.push(` Save: ${scopes.join(" · ")}`);
		}
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
							{ key: "ctrl+s", action: "save", priority: 1 },
							{ key: binding("tui.select.cancel"), action: "cancel edit", priority: 0 },
						]
					: this.#mode === "save"
						? [
								...(this.#allowsScope("user") ? [{ key: "u", action: "user", priority: 0 }] : []),
								...(this.#allowsScope("project")
									? [{ key: "p", action: "project", priority: 0 }]
									: []),
								...(this.#allowsScope("runtime")
									? [{ key: "r", action: "session", priority: 0 }]
									: []),
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

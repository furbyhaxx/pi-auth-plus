/** Staged edits to one model alias. */
import {
	Input,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { SaveScope } from "../../core/config/index.ts";
import { formatSaveOutcome } from "../../core/config/save.ts";
import { type ModelAlias, parseAliases } from "../../models/aliases/index.ts";
import { sanitize } from "../frame/index.ts";
import type { ModelsTabDeps } from "./models.ts";
import type { TabBody, TabViewHost } from "./view.ts";

type AliasDeps = NonNullable<NonNullable<ModelsTabDeps["details"]>["aliases"]>;
const labels = ["ID", "Display name", "Context window", "Max tokens"] as const;
const clean = (value: string) => sanitize(value).replace(/\n/g, " ");

/** An alias editor retained by the owning model detail. */
export class AliasDetail {
	readonly #host: TabViewHost;
	readonly #deps: AliasDeps;
	readonly #provider: string;
	readonly #source: string;
	readonly #original: ModelAlias | undefined;
	readonly #done: (message?: string) => void;
	readonly #input = new Input({ prompt: "", placeholder: "" });
	readonly #initial: string[];
	#values: string[];
	#editInitial = "";
	#selected = 0;
	#offset = 0;
	#mode: "list" | "edit" | "save" = "list";
	#deleted = false;
	#saving = false;
	#disposed = false;
	#message = "";

	constructor(
		host: TabViewHost,
		deps: AliasDeps,
		provider: string,
		source: string,
		original: ModelAlias | undefined,
		done: (message?: string) => void,
	) {
		this.#host = host;
		this.#deps = deps;
		this.#provider = provider;
		this.#source = source;
		this.#original = original;
		this.#done = done;
		this.#initial = [
			original?.id ?? "",
			original?.name ?? "",
			original?.contextWindow?.toString() ?? "",
			original?.maxTokens?.toString() ?? "",
		];
		this.#values = [...this.#initial];
	}

	#changed(): boolean {
		return this.#deleted || this.#values.some((value, index) => value !== this.#initial[index]);
	}

	/** Include staged alias fields, removal and an unfinished input. */
	hasDrafts(): boolean {
		return (
			this.#changed() || (this.#mode === "edit" && this.#input.getValue() !== this.#editInitial)
		);
	}

	/** Discard only this alias editor's drafts. */
	discardDrafts(): void {
		if (this.#saving) return;
		this.#values = [...this.#initial];
		this.#deleted = false;
		this.#mode = "list";
		this.#input.setValue("");
		this.#message = "";
	}

	/** Report an in-flight alias save to the dashboard. */
	isSaving(): boolean {
		return this.#saving;
	}

	#candidate(): readonly ModelAlias[] | undefined {
		const aliases = [...this.#deps.list()];
		let index = aliases.length;
		if (this.#original) {
			index = aliases.findIndex(
				(alias) =>
					alias.provider === this.#original?.provider &&
					alias.id === this.#original.id &&
					alias.source === this.#original.source,
			);
			if (index < 0) {
				this.#message = "Alias changed; reopen to retry";
				return undefined;
			}
			aliases.splice(index, 1);
		}
		if (!this.#deleted) {
			const [id = "", name = "", context = "", output = ""] = this.#values;
			const limit = (value: string) => (/^\d+$/.test(value) ? Number(value) : Number.NaN);
			aliases.splice(index, 0, {
				provider: this.#provider,
				source: this.#source,
				id,
				...(name ? { name } : {}),
				...(context ? { contextWindow: limit(context) } : {}),
				...(output ? { maxTokens: limit(output) } : {}),
			});
		}
		const parsed = parseAliases(aliases);
		if (!parsed)
			this.#message = "Invalid alias: check ID, duplicate IDs and positive integer limits";
		return parsed;
	}

	async #save(scope: SaveScope): Promise<void> {
		const aliases = this.#candidate();
		if (!aliases) {
			this.#mode = "list";
			return;
		}
		this.#saving = true;
		try {
			const outcome = await this.#deps.save(aliases, scope);
			if (this.#disposed) return;
			if (!outcome.committed) {
				this.#message = `Save failed: ${formatSaveOutcome(outcome)}`;
				return;
			}
			this.#values = [...this.#initial];
			this.#deleted = false;
			this.#done(formatSaveOutcome(outcome));
		} catch (error) {
			if (!this.#disposed)
				this.#message = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			this.#saving = false;
			this.#mode = "list";
			if (!this.#disposed) this.#host.refresh();
		}
	}

	/** Returns false when the owner should close this editor. */
	handleInput(data: string): boolean {
		if (this.#saving) return true;
		const { keys } = this.#host;
		const cancel = keys.matches(data, "tui.select.cancel");
		const enter = keys.matches(data, "tui.select.confirm");
		if (this.#mode === "edit") {
			if (cancel) this.#mode = "list";
			else if (enter) {
				this.#values[this.#selected] = this.#input.getValue();
				this.#mode = "list";
			} else if (!matchesKey(data, "ctrl+s")) this.#input.handleInput(data);
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
			if (!this.hasDrafts()) return false;
			if (!this.#host.confirmDiscard) {
				this.#message = "Cannot discard; save or keep editing";
				return true;
			}
			this.#host.confirmDiscard(() => {
				if (this.#disposed || this.#saving) return;
				this.discardDrafts();
				this.#done();
			});
			return true;
		}
		if (matchesKey(data, "ctrl+s")) {
			if (this.#changed() && this.#candidate()) this.#mode = "save";
			else if (!this.#changed()) this.#message = "No staged changes to save";
			return true;
		}
		if (keys.matches(data, "tui.select.up") || data === "k")
			this.#selected = Math.max(0, this.#selected - 1);
		else if (keys.matches(data, "tui.select.down") || data === "j")
			this.#selected = Math.min(labels.length - 1, this.#selected + 1);
		else if (data === "d" && this.#original) {
			this.#deleted = !this.#deleted;
			this.#message = this.#deleted ? "Removal staged" : "Removal cancelled";
		} else if (enter && !this.#deleted) {
			this.#input.setValue("");
			this.#input.handleInput(`\x1b[200~${clean(this.#values[this.#selected] ?? "")}\x1b[201~`);
			this.#editInitial = this.#input.getValue();
			this.#input.focused = true;
			this.#mode = "edit";
			this.#message = "";
		}
		return true;
	}

	/** Render the editor in the dashboard frame. */
	render(width: number, bodyRows: number): TabBody {
		const { theme } = this.#host;
		const rows = [
			` ${clean(this.#provider)}/${clean(this.#source)} · alias${this.#deleted ? " · removal staged" : ""}`,
		];
		for (const [index, label] of labels.entries()) {
			const marker = index === this.#selected ? theme.fg("accent", "❯") : " ";
			const prefix = ` ${marker} ${label} · `;
			const value =
				index === this.#selected && this.#mode === "edit"
					? (this.#input.render(Math.max(0, width - visibleWidth(prefix)))[0] ?? "")
					: clean(this.#values[index] || (index ? "inherit" : "required"));
			rows.push(`${prefix}${value}`);
		}
		const message =
			this.#mode === "save" ? "Save to [u]ser, [p]roject or [r]untime?" : this.#message;
		const details = message
			? wrapTextWithAnsi(clean(message), Math.max(1, width - 1)).map(
					(line) => ` ${theme.fg("warning", line)}`,
				)
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
				theme.fg("dim", this.#changed() ? "staged" : "alias"),
				Math.max(0, width),
				"…",
			),
			description: truncateToWidth(
				theme.fg("muted", "Blank optional fields inherit from the source."),
				Math.max(0, width - 1),
				"…",
			),
			hints:
				this.#mode === "save"
					? [
							{ key: "u/p/r", action: "save scope", priority: 0 },
							{ key: binding("tui.select.cancel"), action: "cancel", priority: 0 },
						]
					: this.#mode === "edit"
						? [
								{ key: binding("tui.select.confirm"), action: "stage", priority: 0 },
								{ key: binding("tui.select.cancel"), action: "cancel", priority: 0 },
							]
						: [
								{ key: binding("tui.select.confirm"), action: "edit", priority: 0 },
								...(this.#original ? [{ key: "d", action: "remove", priority: 1 }] : []),
								{ key: "ctrl+s", action: "save", priority: 0 },
								{ key: binding("tui.select.cancel"), action: "discard/back", priority: 0 },
							],
		};
	}
	/** Ignore late saves after navigation. */
	dispose(): void {
		this.#disposed = true;
	}
}

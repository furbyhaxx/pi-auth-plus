/** Staged model group list and scoped persistence. */
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { SaveScope } from "../../core/config/index.ts";
import { formatSaveOutcome, type SaveOutcome } from "../../core/config/save.ts";
import { type GroupMember, type ModelGroup, parseGroups } from "../../models/groups/config.ts";
import type { GroupMemberHealth } from "../../models/groups/member.ts";
import type { ModelIdentity } from "../../models/groups/priority.ts";
import { sanitize } from "../frame/index.ts";
import { GroupDetail } from "./group-detail.ts";
import type { ModelCatalogItem } from "./models.ts";
import type { TabBody, TabView, TabViewHost } from "./view.ts";

/** Session-owned group configuration, catalog and persistence. */
export interface GroupsTabDeps {
	groups(): readonly ModelGroup[];
	catalog(): readonly ModelCatalogItem[];
	health?(member: GroupMember): GroupMemberHealth;
	current?(groupId: string): ModelIdentity | undefined;
	save(groups: readonly ModelGroup[], scope: SaveScope): Promise<SaveOutcome>;
}

const clean = (value: string): string => sanitize(value).replace(/\n/g, " ");
const healthStates: readonly GroupMemberHealth["state"][] = [
	"healthy",
	"exhausted",
	"needs-auth",
	"unavailable",
	"unknown",
];
const unknownHealth: GroupMemberHealth = { state: "unknown", routable: false };
type GroupRange = { first: number; last: number };

/** A staged group editor with explicit scoped saves. */
export class GroupsView implements TabView {
	readonly #host: TabViewHost;
	readonly #deps: GroupsTabDeps;
	#staged: readonly ModelGroup[] | undefined;
	#detail: GroupDetail | undefined;
	#selected = 0;
	#offset = 0;
	#bodyRows = 1;
	#ranges: GroupRange[] = [];
	#message = "";
	#detailMessage = "";
	#mode: "list" | "save" = "list";
	#saving = false;
	#disposed = false;

	constructor(host: TabViewHost, deps: GroupsTabDeps) {
		this.#host = host;
		this.#deps = deps;
	}

	#groups(): readonly ModelGroup[] {
		return this.#staged ?? this.#deps.groups();
	}

	#move(direction: number): void {
		const groups = this.#groups();
		if (groups.length === 0) return;
		this.#selected = Math.max(0, Math.min(this.#selected, groups.length - 1));
		const range = this.#ranges[this.#selected];
		if (range && range.last - range.first + 1 > this.#bodyRows) {
			const nextOffset = this.#offset + direction;
			if (nextOffset >= range.first && nextOffset <= range.last - this.#bodyRows + 1) {
				this.#offset = nextOffset;
				return;
			}
		}
		const next = Math.max(0, Math.min(groups.length - 1, this.#selected + direction));
		if (next !== this.#selected) {
			this.#selected = next;
			this.#offset = this.#ranges[next]?.first ?? 0;
		}
	}

	#edit(index: number | undefined): void {
		const initial = index === undefined ? undefined : this.#groups()[index];
		this.#detailMessage = "";
		let detail: GroupDetail;
		const back = () => {
			if (this.#detail !== detail) return;
			detail.dispose();
			this.#detail = undefined;
		};
		detail = new GroupDetail(
			this.#host,
			initial,
			() => this.#deps.catalog(),
			(group) => {
				const candidate = [...this.#groups()];
				if (index === undefined) candidate.push(group);
				else candidate[index] = group;
				const parsed = parseGroups(candidate);
				if (!parsed) {
					this.#detailMessage = "Invalid groups or duplicate IDs; choose a unique ID";
					return;
				}
				this.#staged = parsed;
				this.#selected = index ?? parsed.length - 1;
				this.#offset = 0;
				this.#ranges = [];
				this.#message = "";
				back();
			},
			back,
		);
		this.#detail = detail;
	}

	async #save(scope: SaveScope): Promise<void> {
		const groups = this.#staged;
		if (!groups) return;
		this.#saving = true;
		try {
			const outcome = await this.#deps.save(groups, scope);
			if (this.#disposed) return;
			if (outcome.committed) this.#staged = undefined;
			this.#message = formatSaveOutcome(outcome);
		} catch (error) {
			if (!this.#disposed)
				this.#message = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			this.#saving = false;
			this.#mode = "list";
			if (!this.#disposed) this.#host.refresh();
		}
	}

	/** True when this view or its child editor contains unsaved changes. */
	hasDrafts(): boolean {
		return this.#staged !== undefined || Boolean(this.#detail?.hasDrafts());
	}
	/** True while this view or its child editor is saving. */
	isSaving(): boolean {
		return this.#saving || Boolean(this.#detail?.isSaving());
	}
	/** Discard the staged list and every nested editor draft. */
	discardDrafts(): void {
		if (this.isSaving()) return;
		this.#staged = undefined;
		this.#message = "";
		this.#detailMessage = "";
		const detail = this.#detail;
		this.#detail = undefined;
		detail?.discardDrafts();
		detail?.dispose();
	}
	/** Handle list actions, detail editing and scope selection before frame navigation. */
	handleInput(data: string): boolean {
		if (this.#disposed || this.isSaving()) return true;
		if (this.#detail) {
			this.#detailMessage = "";
			this.#detail.handleInput(data);
			return true;
		}
		const { keys } = this.#host;
		const cancel = keys.matches(data, "tui.select.cancel");
		if (this.#mode === "save") {
			if (cancel) this.#mode = "list";
			else if (data === "r") void this.#save("runtime");
			else if (data === "u") void this.#save("user");
			else if (data === "p") void this.#save("project");
			return true;
		}
		if (cancel) return false;
		if (matchesKey(data, "ctrl+s")) {
			if (this.#staged) {
				this.#mode = "save";
				this.#message = "";
			} else this.#message = "No staged changes to save";
			return true;
		}
		const groups = this.#groups();
		this.#selected = Math.max(0, Math.min(this.#selected, groups.length - 1));
		if (keys.matches(data, "tui.select.up") || data === "k") this.#move(-1);
		else if (keys.matches(data, "tui.select.down") || data === "j") this.#move(1);
		else if (data === "a") this.#edit(undefined);
		else if (keys.matches(data, "tui.select.confirm") && groups[this.#selected])
			this.#edit(this.#selected);
		else if (data === "d" && groups[this.#selected]) {
			const candidate = [...groups];
			candidate.splice(this.#selected, 1);
			const parsed = parseGroups(candidate);
			if (!parsed) this.#message = "Invalid groups; cannot stage removal";
			else {
				this.#staged = parsed;
				this.#selected = Math.max(0, Math.min(this.#selected, parsed.length - 1));
				this.#offset = 0;
				this.#ranges = [];
				this.#message = "";
			}
		} else return false;
		return true;
	}

	/** Render the scrollable list, modal editor or scope selector. */
	render(width: number, bodyRows: number): TabBody {
		if (this.#detail) {
			if (!this.#detailMessage || bodyRows <= 0) return this.#detail.render(width, bodyRows);
			const body = this.#detail.render(width, Math.max(0, bodyRows - 1));
			return {
				...body,
				lines: [
					...body.lines,
					truncateToWidth(
						this.#host.theme.fg("warning", ` ${clean(this.#detailMessage)}`),
						Math.max(0, width),
						"…",
					),
				],
			};
		}
		const { theme } = this.#host;
		const groups = this.#groups();
		this.#selected = Math.max(0, Math.min(this.#selected, groups.length - 1));
		const rows: string[] = [];
		const ranges: GroupRange[] = [];
		for (const [index, group] of groups.entries()) {
			const first = rows.length;
			const memberHealth = group.members.map((member) => ({
				member,
				health: this.#deps.health?.(member) ?? unknownHealth,
			}));
			const counts: Record<GroupMemberHealth["state"], number> = {
				healthy: 0,
				unknown: 0,
				unavailable: 0,
				"needs-auth": 0,
				exhausted: 0,
			};
			for (const { health } of memberHealth) counts[health.state]++;
			const summary =
				healthStates
					.filter((state) => counts[state] > 0)
					.map((state) => `${counts[state]} ${state}`)
					.join(" · ") || "no member health";
			rows.push(
				` ${index === this.#selected ? theme.fg("accent", "❯") : " "} ${clean(group.id)} · ${summary}${group.name ? ` · ${clean(group.name)}` : ""} · ${group.strategy} · ${group.members.length} members`,
			);
			const current = this.#deps.current?.(group.id);
			rows.push(
				` Selected route: ${current ? `${clean(current.provider)}/${clean(current.id)}` : "unknown"}`,
			);
			for (const { member, health } of memberHealth) {
				const eligibility = health.routable
					? health.state === "unknown"
						? "best-effort"
						: "routable"
					: "not routable";
				rows.push(
					` ${health.state} · ${eligibility} ${clean(member.provider)}/${clean(member.id)}`,
				);
			}
			ranges.push({ first, last: rows.length - 1 });
		}
		if (!rows.length) rows.push(" No groups configured.");
		const details =
			this.#mode === "save"
				? [this.#saving ? " Saving…" : " Save scope: r runtime · u user · p project"]
				: this.#message
					? [` ${theme.fg("warning", clean(this.#message))}`]
					: [];
		const reserved = Math.min(details.length, Math.max(0, bodyRows - 1));
		const available = Math.max(0, bodyRows - reserved);
		this.#ranges = ranges;
		this.#bodyRows = Math.max(1, available);
		const selectedRange = ranges[this.#selected];
		if (!selectedRange || this.#offset < selectedRange.first || this.#offset > selectedRange.last)
			this.#offset = selectedRange?.first ?? 0;
		const maxOffset = selectedRange
			? Math.max(selectedRange.first, selectedRange.last - this.#bodyRows + 1)
			: 0;
		this.#offset = Math.max(selectedRange?.first ?? 0, Math.min(this.#offset, maxOffset));
		this.#offset = Math.max(0, Math.min(this.#offset, rows.length - available));
		const binding = (id: Parameters<TabViewHost["binding"]>[0]) => this.#host.binding(id);
		return {
			lines: [
				...rows.slice(this.#offset, this.#offset + available),
				...details.slice(0, reserved),
			].map((line) => truncateToWidth(line, Math.max(0, width), "…")),
			above: this.#offset,
			below: Math.max(0, rows.length - this.#offset - available),
			modal: this.#mode === "save" || this.#saving,
			state: truncateToWidth(
				theme.fg("dim", `${groups.length} groups${this.#staged ? " · staged" : ""}`),
				Math.max(0, width),
				"…",
			),
			description: truncateToWidth(
				theme.fg("muted", "Groups route requests to ordered members."),
				Math.max(0, width),
				"…",
			),
			hints:
				this.#mode === "save"
					? [
							{ key: "r", action: "runtime", priority: 0 },
							{ key: "u", action: "user", priority: 0 },
							{ key: "p", action: "project", priority: 0 },
							{ key: binding("tui.select.cancel"), action: "cancel", priority: 0 },
						]
					: [
							{ key: `a/${binding("tui.select.confirm")}`, action: "add/edit", priority: 0 },
							{ key: "d", action: "delete", priority: 1 },
							{ key: "ctrl+s", action: "save", priority: 0 },
							{
								key: `${binding("tui.select.up")}/${binding("tui.select.down")}`,
								action: "move",
								priority: 2,
							},
						],
		};
	}

	/** Prevent late saves from redrawing a closed dashboard. */
	dispose(): void {
		this.#disposed = true;
		this.#detail?.dispose();
	}
}

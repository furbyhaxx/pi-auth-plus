import { expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionVirtualModel,
} from "@earendil-works/pi-coding-agent";
import type { ModelGroup } from "../../../src/models/groups/config.ts";
import type { ModelIdentity } from "../../../src/models/groups/priority.ts";
import { GroupRegistrations } from "../../../src/models/groups/registration.ts";
import type { GroupRouteState } from "../../../src/models/groups/route.ts";

const group = (id: string): ModelGroup => ({
	id,
	strategy: "sticky",
	triggers: ["rate-limit"],
	members: [{ provider: "physical", id: "model", tier: 1 }],
});

function fixture(visible?: (id: string) => boolean) {
	const registered = new Set<string>();
	const definitions = new Map<string, ExtensionVirtualModel<GroupRouteState>>();
	const registerFailures = new Map<string, unknown>();
	const removeFailures = new Map<string, unknown>();
	const failures = new Map<string, ModelIdentity>();
	const switches: ModelGroup[] = [];
	const removed: string[] = [];
	const removalAttempts: string[] = [];
	let configured = [group("first"), group("second")];
	const pi = {
		registerVirtualModel: (definition: ExtensionVirtualModel<GroupRouteState>) => {
			const { provider, id } = definition;
			if (registerFailures.has(id)) throw registerFailures.get(id);
			registered.add(`${provider}/${id}`);
			definitions.set(id, definition);
		},
		unregisterVirtualModel: (provider: string, id: string) => {
			removalAttempts.push(`${provider}/${id}`);
			if (removeFailures.has(id)) throw removeFailures.get(id);
			registered.delete(`${provider}/${id}`);
			definitions.delete(id);
			removed.push(`${provider}/${id}`);
		},
	} as unknown as ExtensionAPI;
	const registrations = new GroupRegistrations(pi, {
		groups: () => configured,
		quota: () => undefined,
		takeFailed: (id) => {
			const failed = failures.get(id);
			failures.delete(id);
			return failed;
		},
		onSwitch: (current) => switches.push(current),
		...(visible ? { visible } : {}),
	});
	return {
		registered,
		definitions,
		registerFailures,
		removeFailures,
		failures,
		switches,
		removed,
		removalAttempts,
		registrations,
		configure: (groups: ModelGroup[]) => {
			configured = groups;
		},
	};
}

test("filters hidden groups, unregisters newly hidden groups and restores them", () => {
	const hidden = new Set(["first"]);
	const { registrations, registered, removed } = fixture((id) => !hidden.has(id));
	registrations.apply();
	expect([...registered]).toEqual(["group/second"]);
	expect(registrations.ids).toEqual(["second"]);
	hidden.add("second");
	registrations.apply();
	expect([...registered]).toEqual([]);
	expect(removed).toEqual(["group/second"]);
	expect(registrations.ids).toEqual([]);
	hidden.clear();
	registrations.apply();
	expect([...registered]).toEqual(["group/first", "group/second"]);
	expect(registrations.ids).toEqual(["first", "second"]);
});

test("defaults to visible and removes groups deleted from configuration", () => {
	const { registrations, registered, removed, configure } = fixture();
	registrations.apply();
	expect([...registered]).toEqual(["group/first", "group/second"]);
	configure([group("second")]);
	registrations.apply();
	expect([...registered]).toEqual(["group/second"]);
	expect(removed).toEqual(["group/first"]);
});

test("keeps a failed replacement tracked so later deletion unregisters it", () => {
	const { registrations, definitions, registerFailures, removed, configure } = fixture();
	registrations.apply();
	const original = definitions.get("first");
	const updatedSecond = { ...group("second"), name: "updated second" };
	configure([{ ...group("first"), name: "replacement" }, updatedSecond]);
	registerFailures.set("first", new Error("replacement rejected"));
	const warnings = registrations.apply();
	const trackedAfterFailure = registrations.ids;
	const retained = definitions.get("first");
	const second = definitions.get("second");

	configure([updatedSecond]);
	const removalWarnings = registrations.apply();
	expect(removed).toEqual(["group/first"]);
	expect(trackedAfterFailure).toEqual(["first", "second"]);
	expect(retained).toBe(original);
	expect(second?.name).toBe("updated second");
	expect(registrations.ids).toEqual(["second"]);
	expect(removalWarnings).toEqual([]);
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toContain("group/first");
	expect(warnings[0]).toContain("replacement rejected");
	expect(warnings[0]).toContain("retry");
});

test("does not track a failed new registration and still registers other groups", () => {
	const { registrations, registered, registerFailures, removalAttempts, configure } = fixture();
	configure([group("bad"), group("good")]);
	registerFailures.set("bad", "registration unavailable");
	const warnings = registrations.apply();
	expect([...registered]).toEqual(["group/good"]);
	expect(registrations.ids).toEqual(["good"]);
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toContain("group/bad");
	expect(warnings[0]).toContain("registration unavailable");
	expect(warnings[0]).toContain("retry");

	configure([group("good")]);
	expect(registrations.apply()).toEqual([]);
	expect(removalAttempts).toEqual([]);
	registerFailures.delete("bad");
	configure([group("bad"), group("good")]);
	expect(registrations.apply()).toEqual([]);
	expect(registrations.ids).toEqual(["bad", "good"]);
});

test("retries failed removals while continuing other removals and registrations", () => {
	const { registrations, registered, removeFailures, removed, removalAttempts, configure } =
		fixture();
	registrations.apply();
	removeFailures.set("first", new Error("registry unavailable"));
	configure([group("third")]);
	const warnings = registrations.apply();
	expect([...registered]).toEqual(["group/first", "group/third"]);
	expect(registrations.ids).toEqual(["first", "third"]);
	expect(removed).toEqual(["group/second"]);
	expect(removalAttempts).toEqual(["group/first", "group/second"]);
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toContain("group/first");
	expect(warnings[0]).toContain("registry unavailable");
	expect(warnings[0]).toContain("Retry applying the group settings");

	removeFailures.delete("first");
	expect(registrations.apply()).toEqual([]);
	expect(removalAttempts).toEqual(["group/first", "group/second", "group/first"]);
	expect(removed).toEqual(["group/second", "group/first"]);
	expect(registrations.ids).toEqual(["third"]);
});

test("retries removal when a group becomes hidden", () => {
	const hidden = new Set<string>();
	const { registrations, registered, removeFailures, removed } = fixture((id) => !hidden.has(id));
	registrations.apply();
	hidden.add("first");
	removeFailures.set("first", new Error("registry unavailable"));
	expect(registrations.apply()).toHaveLength(1);
	expect(registrations.ids).toEqual(["first", "second"]);
	expect([...registered]).toEqual(["group/first", "group/second"]);

	removeFailures.delete("first");
	expect(registrations.apply()).toEqual([]);
	expect(removed).toEqual(["group/first"]);
	expect(registrations.ids).toEqual(["second"]);
});

test("returns sanitized warnings for each failed operation", () => {
	const { registrations, removeFailures, registerFailures, configure } = fixture();
	registrations.apply();
	removeFailures.set("first", new Error("blocked \u001b[31mBearer fake-token\u001b[0m"));
	registerFailures.set("bad", { code: "rejected" });
	configure([group("bad"), group("third")]);
	const warnings = registrations.apply();
	expect(warnings).toHaveLength(2);
	expect(warnings[0]).toContain("unregister group/first");
	expect(warnings[0]).toContain("[redacted]");
	expect(warnings[0]).not.toContain("fake-token");
	expect(warnings[0]).not.toContain("\u001b");
	expect(warnings[1]).toContain("register group/bad");
	expect(warnings[1]).toContain("Unknown error");
	expect(registrations.ids).toEqual(["first", "third"]);
});

test("reports switches using the config of the accepted registration", async () => {
	const { registrations, definitions, registerFailures, failures, switches, configure } = fixture();
	const initial: ModelGroup = {
		...group("first"),
		name: "accepted",
		members: [...group("first").members, { provider: "physical", id: "backup", tier: 1 }],
	};
	const replacement = { ...initial, name: "replacement" };
	configure([initial]);
	registrations.apply();
	configure([replacement]);
	registerFailures.set("first", new Error("replacement rejected"));
	registrations.apply();

	const model = (id: string): Model<Api> => ({
		provider: "physical",
		id,
		name: id,
		api: "openai-completions",
		baseUrl: "",
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		reasoning: false,
		contextWindow: 1000,
		maxTokens: 500,
	});
	const first = model("model");
	const models = [first, model("backup")];
	const ctx = {
		modelRegistry: {
			find: (provider: string, id: string) =>
				models.find((item) => item.provider === provider && item.id === id),
			getAvailable: () => models,
		},
	} as ExtensionContext;
	async function route() {
		const definition = definitions.get("first");
		if (!definition) throw new Error("missing group registration");
		failures.set("first", { provider: "physical", id: "model" });
		await definition.route(
			{ model: first, thinkingLevel: "off", reason: "user", messages: [] },
			ctx,
		);
	}

	await route();
	expect(switches).toEqual([initial]);
	registerFailures.delete("first");
	registrations.apply();
	await route();
	expect(switches).toEqual([initial, replacement]);
});

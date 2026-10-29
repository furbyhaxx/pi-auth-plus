import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ModelGroup } from "../../../src/models/groups/config.ts";
import { GroupRegistrations } from "../../../src/models/groups/registration.ts";

const group = (id: string): ModelGroup => ({
	id,
	strategy: "sticky",
	triggers: ["rate-limit"],
	members: [{ provider: "physical", id: "model", tier: 1 }],
});

function fixture(visible?: (id: string) => boolean) {
	const registered = new Set<string>();
	const removed: string[] = [];
	let configured = [group("first"), group("second")];
	const pi = {
		registerVirtualModel: ({ provider, id }: { provider: string; id: string }) => {
			registered.add(`${provider}/${id}`);
		},
		unregisterVirtualModel: (provider: string, id: string) => {
			registered.delete(`${provider}/${id}`);
			removed.push(`${provider}/${id}`);
		},
	} as unknown as ExtensionAPI;
	const registrations = new GroupRegistrations(pi, {
		groups: () => configured,
		quota: () => undefined,
		takeFailed: () => undefined,
		...(visible ? { visible } : {}),
	});
	return {
		registered,
		removed,
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

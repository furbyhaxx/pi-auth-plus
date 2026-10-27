import { describe, expect, test } from "bun:test";
import type { Credential, CredentialStore, OAuthCredential } from "@earendil-works/pi-ai";
import { migrateForkLogin } from "../../../src/families/google/migration.ts";

function fakeStore(initial: Readonly<Record<string, Credential>> = {}) {
	const slots = new Map(Object.entries(initial));
	const writes: string[] = [];
	const store: CredentialStore = {
		async read(providerId) {
			return slots.get(providerId);
		},
		async list() {
			return [...slots].map(([providerId, credential]) => ({ providerId, type: credential.type }));
		},
		async modify(providerId, fn) {
			const next = await fn(slots.get(providerId));
			if (next !== undefined) {
				slots.set(providerId, next);
				writes.push(providerId);
			}
			return slots.get(providerId);
		},
		async delete(providerId) {
			slots.delete(providerId);
		},
	};
	return { store, slots, writes };
}

const forkLogin: OAuthCredential = {
	type: "oauth",
	access: "access-placeholder",
	refresh: "refresh-placeholder|project-placeholder|managed-placeholder",
	expires: 123,
	projectId: "project-placeholder",
};

describe("migrateForkLogin", () => {
	for (const refresh of [
		"refresh-placeholder|project-placeholder|managed-placeholder",
		"refresh-placeholder|project-placeholder",
		"refresh-placeholder",
	]) {
		test(`fills an empty slot from a refresh with ${refresh.split("|").length} segments`, async () => {
			const google = { ...forkLogin, refresh };
			const original = JSON.stringify(google);
			const { store, slots, writes } = fakeStore({ google });

			expect(await migrateForkLogin(store)).toBe("migrated");
			expect(slots.get("antigravity")).toEqual({
				type: "oauth",
				access: "access-placeholder",
				refresh: "refresh-placeholder",
				expires: 123,
			});
			expect(slots.get("google")).toBe(google);
			expect(JSON.stringify(slots.get("google"))).toBe(original);
			expect(writes).toEqual(["antigravity"]);
			expect(await migrateForkLogin(store)).toBe("skipped-existing");
			expect(writes).toEqual(["antigravity"]);
		});
	}

	test("preserves an existing antigravity slot", async () => {
		const antigravity: Credential = { type: "api_key", key: "key-placeholder" };
		const { store, slots, writes } = fakeStore({ google: forkLogin, antigravity });
		expect(await migrateForkLogin(store)).toBe("skipped-existing");
		expect(slots.get("antigravity")).toBe(antigravity);
		expect(writes).toEqual([]);
	});

	test("does not overwrite a login inserted before the locked modification", async () => {
		const { store, slots, writes } = fakeStore({ google: forkLogin });
		const antigravity: Credential = { ...forkLogin, refresh: "new-placeholder" };
		const modify = store.modify;
		store.modify = async (providerId, fn, options) => {
			slots.set("antigravity", antigravity);
			return modify(providerId, fn, options);
		};
		expect(await migrateForkLogin(store)).toBe("skipped-existing");
		expect(slots.get("antigravity")).toBe(antigravity);
		expect(writes).toEqual([]);
	});

	test("ignores a google API-key slot", async () => {
		const google: Credential = { type: "api_key", key: "key-placeholder" };
		const { store, slots, writes } = fakeStore({ google });
		expect(await migrateForkLogin(store)).toBe("not-oauth");
		expect(slots.get("google")).toBe(google);
		expect(slots.has("antigravity")).toBe(false);
		expect(writes).toEqual([]);
	});

	test("ignores an absent google slot", async () => {
		const { store, slots, writes } = fakeStore();
		expect(await migrateForkLogin(store)).toBe("no-fork-slot");
		expect(slots.size).toBe(0);
		expect(writes).toEqual([]);
	});
});

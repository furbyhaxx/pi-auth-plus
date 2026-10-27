/** Exercises credential-scoped, session-local project discovery. */
import { expect, test } from "bun:test";
import {
	AntigravityProjectError,
	antigravityProject,
} from "../../../src/families/google/project.ts";

const signal = new AbortController().signal;

test("discovery shares one in-flight call per credential and resets per session", async () => {
	let key = "test-refresh-one";
	let calls = 0;
	const resolver = antigravityProject({
		cacheKey: () => key,
		headers: () => ({ "User-Agent": "test-cli", "Accept-Encoding": "gzip" }),
		fetch: async (input, init) => {
			calls++;
			expect(String(input)).toBe(
				"https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
			);
			expect(init?.method).toBe("POST");
			expect(init?.body).toBe('{"metadata":{"ideType":"ANTIGRAVITY"}}');
			const headers = new Headers(init?.headers);
			expect(headers.get("authorization")).toBe("Bearer test-access");
			expect(headers.get("user-agent")).toBe("test-cli");
			expect(headers.get("content-type")).toBe("application/json");
			return Response.json({ cloudaicompanionProject: `project-${calls}` });
		},
	});
	expect(
		await Promise.all([
			resolver.resolve("test-access", signal),
			resolver.resolve("test-access", signal),
		]),
	).toEqual(["project-1", "project-1"]);
	expect(await resolver.resolve("rotated-access", signal)).toBe("project-1");
	expect(calls).toBe(1);
	key = "test-refresh-two";
	expect(await resolver.resolve("test-access", signal)).toBe("project-2");
	resolver.reset();
	expect(await resolver.resolve("test-access", signal)).toBe("project-3");
	expect(calls).toBe(3);
});

test("missing project fails with recovery and does not onboard or cache the failure", async () => {
	let calls = 0;
	const resolver = antigravityProject({
		cacheKey: () => "test-key",
		headers: () => ({}),
		fetch: async () => {
			calls++;
			return Response.json({ allowedTiers: [{ id: "free-tier" }] });
		},
	});
	await expect(resolver.resolve("test-access", signal)).rejects.toThrow(
		"sign in to Antigravity once",
	);
	await expect(resolver.resolve("test-access", signal)).rejects.toBeInstanceOf(
		AntigravityProjectError,
	);
	expect(calls).toBe(2);
});

test("discovery HTTP errors name the operation and never expose credentials", async () => {
	const resolver = antigravityProject({
		cacheKey: () => "test-refresh",
		headers: () => ({}),
		fetch: async () => new Response("test-access test-refresh", { status: 401 }),
	});
	try {
		await resolver.resolve("test-access", signal);
		throw new Error("Expected failure");
	} catch (error) {
		expect(error).toBeInstanceOf(AntigravityProjectError);
		if (!(error instanceof AntigravityProjectError)) throw error;
		expect(error.message).toContain("loadCodeAssist");
		expect(error.message).toContain("HTTP 401");
		expect(error.message).toContain("run /login antigravity again");
		expect(error.message).not.toContain("test-access");
		expect(error.message).not.toContain("test-refresh");
	}
});

test("reset detaches old discoveries while they finish", async () => {
	let calls = 0;
	let release: (value: Response) => void = () => {};
	const resolver = antigravityProject({
		cacheKey: () => "test-key",
		headers: () => ({}),
		fetch: async () => {
			calls++;
			if (calls === 1)
				return new Promise<Response>((resolve) => {
					release = resolve;
				});
			return Response.json({ cloudaicompanionProject: "new-project" });
		},
	});
	const previous = resolver.resolve("old-access", signal);
	resolver.reset();
	expect(await resolver.resolve("new-access", signal)).toBe("new-project");
	release(Response.json({ cloudaicompanionProject: "old-project" }));
	expect(await previous).toBe("old-project");
	expect(await resolver.resolve("new-access", signal)).toBe("new-project");
	expect(calls).toBe(2);
});

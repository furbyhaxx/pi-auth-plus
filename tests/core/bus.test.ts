import { describe, expect, test } from "bun:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { channelName, publish, request, serve, subscribe } from "../../src/core/bus/index.ts";

const asNumber = (raw: unknown) => (typeof raw === "number" ? raw : undefined);
const asQuery = (raw: unknown) =>
	typeof raw === "object" && raw !== null && "n" in raw && typeof raw.n === "number"
		? { n: raw.n }
		: undefined;

describe("core/bus", () => {
	test("concurrent requests each receive only their own reply", async () => {
		const bus = createEventBus();
		serve(bus, "tokens", "count", asQuery, async ({ n }) => {
			await new Promise((resolve) => setTimeout(resolve, n === 1 ? 20 : 1));
			return n * 10;
		});
		const [one, two] = await Promise.all([
			request(bus, "tokens", "count", { n: 1 }, asNumber),
			request(bus, "tokens", "count", { n: 2 }, asNumber),
		]);
		expect([one, two]).toEqual([10, 20]);
	});

	test("no server resolves undefined after the timeout", async () => {
		const bus = createEventBus();
		expect(
			await request(bus, "quotas", "snapshot", {}, asNumber, { timeoutMs: 5 }),
		).toBeUndefined();
	});

	test("broadcasts are redacted and undecodable payloads never reach handlers", () => {
		const bus = createEventBus();
		const seen: unknown[] = [];
		bus.on(channelName("auth", "status"), (raw) => seen.push(raw));
		const decoded: number[] = [];
		subscribe(bus, "auth", "status", asNumber, (n) => decoded.push(n));

		publish(bus, "auth", "status", { provider: "claude", accessToken: "secret-value-123" });
		publish(bus, "auth", "status", 7);

		expect(seen[0]).toEqual({ provider: "claude", accessToken: "[redacted]" });
		expect(decoded).toEqual([7]);
	});
});

/** Response byte-boundary and bounded-buffer contracts. */
import { describe, expect, test } from "bun:test";
import {
	MAX_JSON_TOOL_NAME_BYTES,
	MAX_SSE_LINE_BYTES,
	ResponseRestoreLimitError,
	restoreToolNames,
} from "../../../src/families/anthropic/response.ts";
import { toolNameRestorer } from "../../../src/families/anthropic/tool-names.ts";

const encoder = new TextEncoder();
const restore = toolNameRestorer(["bash", "MyCustomTool", "web_search"]);

function response(chunks: Uint8Array[], type = "application/json", headers = {}) {
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			},
		}),
		{ status: 207, statusText: "Multi-Status", headers: { "content-type": type, ...headers } },
	);
}

const input =
	'{"text":"é🦊 escaped \\"name\\":\\"mcp_Bash\\"",' +
	'"tools":[{"name" : "mcp_Bash"},{"name":"mcp_MyCustomTool"},' +
	'{"name":"mcp_Web_search"},{"name":"mcp_É🦊"},{"name":"other"},' +
	'{"name":"x_mcp_Bash"}]}';
const expected = input
	.replace('"mcp_Bash"}', '"bash"}')
	.replace('"mcp_MyCustomTool"', '"MyCustomTool"')
	.replace('"mcp_Web_search"', '"web_search"')
	.replace('"mcp_É🦊"', '"é🦊"');

describe("families/anthropic/response", () => {
	for (const type of ["application/json", "application/problem+json", "text/event-stream"]) {
		test(`${type}: every byte split and single-byte chunks`, async () => {
			const source = type === "text/event-stream" ? `data: ${input}\r\n\rdata: é🦊\n` : input;
			const target = type === "text/event-stream" ? `data: ${expected}\r\n\rdata: é🦊\n` : expected;
			const bytes = encoder.encode(source);
			for (let split = 0; split <= bytes.length; split++) {
				const result = restoreToolNames(
					response([bytes.subarray(0, split), bytes.subarray(split)], type),
					restore,
				);
				expect(await result.text()).toBe(target);
			}
			const chunks = Array.from(bytes, (byte) => Uint8Array.of(byte));
			expect(await restoreToolNames(response(chunks, type), restore).text()).toBe(target);
		});
	}

	test("callbacks receive only complete prefixed names and may expand them", async () => {
		const seen: string[] = [];
		const expanded = "a".repeat(4096);
		for (const type of ["application/json", "text/event-stream"]) {
			const source = '{"name":"ordinary","name":"mcp_A","name":"mcp_"}';
			const result = restoreToolNames(response([encoder.encode(source)], type), (wire) => {
				seen.push(wire);
				return expanded;
			});
			expect(await result.text()).toBe(
				`{"name":"ordinary","name":"${expanded}","name":"${expanded}"}`,
			);
		}
		expect(seen).toEqual(["mcp_A", "mcp_", "mcp_A", "mcp_"]);
	});

	test("JSON escapes are decoded and restored names are safely escaped", async () => {
		const source = '{"name":"mcp_A\\"B","text":"\\"name\\":\\"mcp_Bash\\""}';
		const seen: string[] = [];
		const result = restoreToolNames(response([encoder.encode(source)]), (wire) => {
			seen.push(wire);
			return 'a"b';
		});
		expect(await result.text()).toBe('{"name":"a\\"b","text":"\\"name\\":\\"mcp_Bash\\""}');
		expect(seen).toEqual(['mcp_A"B']);
	});

	test("JSON preserves invalid UTF-8 and truncated candidates byte-for-byte", async () => {
		for (const tail of [Uint8Array.of(0xff, 0x22, 0x7d), Uint8Array.of(0xc3)]) {
			const bytes = new Uint8Array([...encoder.encode('{"name":"mcp_'), ...tail]);
			const result = restoreToolNames(
				response(Array.from(bytes, (b) => Uint8Array.of(b))),
				restore,
			);
			expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
		}
	});

	test("bounds JSON candidates and SSE lines in bytes", async () => {
		for (const ending of ["", "\n"]) {
			const bytes = encoder.encode("x".repeat(MAX_SSE_LINE_BYTES + 1) + ending);
			await expect(
				restoreToolNames(response([bytes], "text/event-stream"), restore).text(),
			).rejects.toBeInstanceOf(ResponseRestoreLimitError);
		}
		const exact = "x".repeat(MAX_SSE_LINE_BYTES);
		expect(
			await restoreToolNames(
				response([encoder.encode(exact)], "text/event-stream"),
				restore,
			).text(),
		).toBe(exact);
		const longName = `mcp_${"a".repeat(MAX_JSON_TOOL_NAME_BYTES - 4)}`;
		expect(
			await restoreToolNames(response([encoder.encode(`{"name":"${longName}"}`)]), restore).text(),
		).toBe(`{"name":"${longName.slice(4)}"}`);
		await expect(
			restoreToolNames(response([encoder.encode(`{"name":"${longName}a"}`)]), restore).text(),
		).rejects.toThrow(`claude: JSON tool name exceeds ${MAX_JSON_TOOL_NAME_BYTES}`);
	});

	test("preserves metadata and removes all stale representation headers", async () => {
		const stale = [
			"content-length",
			"content-encoding",
			"content-md5",
			"content-digest",
			"digest",
			"content-range",
			"etag",
		];
		for (const type of ["Text/Event-Stream; charset=utf-8", "application/json"]) {
			const result = restoreToolNames(
				response([encoder.encode('{"name":"mcp_Bash"}')], type, {
					...Object.fromEntries(stale.map((name) => [name, "1"])),
					"x-request-id": "retained",
				}),
				restore,
			);
			expect(result.status).toBe(207);
			expect(result.statusText).toBe("Multi-Status");
			expect(result.headers.get("x-request-id")).toBe("retained");
			for (const name of stale) expect(result.headers.has(name)).toBe(false);
			expect(await result.text()).toBe('{"name":"bash"}');
		}
	});

	test("other media types and bodiless responses retain identity", () => {
		for (const source of [new Response(null, { status: 204 }), response([], "text/plain")]) {
			expect(restoreToolNames(source, restore)).toBe(source);
		}
	});

	test("emits complete chunks before the upstream body closes", async () => {
		for (const type of ["application/json", "text/event-stream"]) {
			let close: () => void = () => undefined;
			const source = new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(encoder.encode('{"name":"mcp_Bash"}\n'));
						close = () => controller.close();
					},
				}),
				{ headers: { "content-type": type } },
			);
			const reader = restoreToolNames(source, restore).body?.getReader();
			if (!reader) throw new Error("missing transformed body");
			const first = await reader.read();
			close();
			expect(new TextDecoder().decode(first.value)).toBe('{"name":"bash"}\n');
			expect((await reader.read()).done).toBe(true);
		}
	});

	test("propagates upstream failures", async () => {
		for (const type of ["application/json", "text/event-stream"]) {
			const source = new Response(
				new ReadableStream({
					start(controller) {
						controller.error(new Error("upstream failed"));
					},
				}),
				{ headers: { "content-type": type } },
			);
			await expect(restoreToolNames(source, restore).text()).rejects.toThrow("upstream failed");
		}
	});
});

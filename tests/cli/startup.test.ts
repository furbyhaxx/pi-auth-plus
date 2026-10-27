import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SETTINGS } from "../../src/core/config/catalog.ts";
import { SettingsStore } from "../../src/core/config/index.ts";
import { Registry } from "../../src/core/registry/index.ts";
import { FAMILIES } from "../../src/families/index.ts";
import { QuotaEngine } from "../../src/quotas/engine.ts";

const PTY_PROBE = `
import os, pty, select, subprocess, sys, time
master, slave = pty.openpty()
proc = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
output = bytearray()
deadline = time.monotonic() + 15
while time.monotonic() < deadline:
    if select.select([master], [], [], 0.1)[0]:
        try:
            chunk = os.read(master, 65536)
        except OSError:
            break
        if not chunk:
            break
        output.extend(chunk)
    elif proc.poll() is not None:
        break
if proc.poll() is None:
    proc.kill()
proc.wait()
os.close(master)
sys.stdout.buffer.write(output)
sys.exit(proc.returncode if proc.returncode >= 0 else 124)
`;

test("one-shot queries finish before terminal startup, using the shared cache", async () => {
	const dir = await mkdtemp(join(tmpdir(), "auth-plus-cli-startup-"));
	const settings = new SettingsStore(SETTINGS, { user: join(dir, "auth-plus.json") });
	const engine = new QuotaEngine({
		registry: new Registry(FAMILIES),
		settings: () => settings,
		cachePath: join(dir, "cache", "auth-plus", "quotas.json"),
		now: Date.now,
		fetch: async () => {
			throw new Error("Unexpected fetch");
		},
		authFor: async () => {
			throw new Error("Unexpected credential lookup");
		},
	});
	try {
		await engine.cache.put("claude", {
			snapshot: {
				provider: "claude",
				fetchedAt: Date.now(),
				source: "endpoint",
				windows: [{ id: "5h", label: "Session", shortLabel: "5h", usedFraction: 0.25 }],
			},
			drainage: [],
		});
		const args = [
			process.env["PI_BIN"] ?? "pi-bolt",
			"--no-session",
			"-ne",
			"--offline",
			"-e",
			resolve("src/index.ts"),
		];
		for (const flag of ["--quotas-list", "--quotas-json"]) {
			const proc = Bun.spawn(["python3", "-c", PTY_PROBE, ...args, flag, "cc"], {
				cwd: dir,
				env: { ...process.env, PI_CODING_AGENT_DIR: dir, NO_COLOR: "1" },
				stdout: "pipe",
				stderr: "pipe",
			});
			const output = await new Response(proc.stdout).text();
			const errors = await new Response(proc.stderr).text();
			expect(await proc.exited, errors).toBe(0);
			expect(output).toContain("claude");
			expect(output).not.toContain("\x1b[?1049h");
			expect(output).not.toContain("\x1b[?25l");
			expect(output).not.toContain("Model scope:");
			if (flag === "--quotas-json") expect(JSON.parse(output).providers[0].id).toBe("claude");
		}
	} finally {
		engine.stop();
		await rm(dir, { recursive: true, force: true });
	}
}, 30_000);

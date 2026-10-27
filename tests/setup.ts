/** Isolates HOME, XDG and Pi agent dirs per test file so no test touches real state. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "pi-auth-plus-test-"));

process.env["HOME"] = join(root, "home");
process.env["XDG_CONFIG_HOME"] = join(root, "config");
process.env["XDG_CACHE_HOME"] = join(root, "cache");
process.env["XDG_STATE_HOME"] = join(root, "state");
process.env["XDG_DATA_HOME"] = join(root, "data");
process.env["PI_CODING_AGENT_DIR"] = join(root, "agent");
process.env["PI_OFFLINE"] = "1";

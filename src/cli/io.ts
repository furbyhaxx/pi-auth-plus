/** Output and exit codes for the one-shot CLI. */
import { writeSync } from "node:fs";

export const EXIT_OK = 0;
export const EXIT_PARTIAL = 1;
export const EXIT_USAGE = 2;

export function wantsColor(): boolean {
	if (process.env["NO_COLOR"] !== undefined) return false;
	if (process.env["FORCE_COLOR"] === "0") return false;
	return process.stdout.isTTY === true;
}

/** Pi owns process.stdout (TUI stream), so CLI output goes straight to the file descriptor. */
export function writeFd(fd: 1 | 2, text: string): void {
	const buffer = Buffer.from(text, "utf8");
	let offset = 0;
	while (offset < buffer.length) {
		try {
			offset += writeSync(fd, buffer, offset, buffer.length - offset);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "EAGAIN") continue;
			throw error;
		}
	}
}

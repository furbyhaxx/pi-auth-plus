/** The agy CLI's identity on Cloud Code PA: pinned version, user agent and header set. */

/**
 * Pinned to the installed agy 1.5.15 (`.project/analyses/antigravity-cli/tracking.md`). The
 * change-list number is the last one observed on the wire (1.4.8); 1.5.15 does not expose it.
 */
export const AGY_VERSION = "1.5.15";
export const AGY_CHANGE_LIST = "1007749967";
export const BASE_URL = "https://daily-cloudcode-pa.googleapis.com";

const GO_OS: Readonly<Record<string, string>> = { win32: "windows" };
const GO_ARCH: Readonly<Record<string, string>> = { x64: "amd64", ia32: "386" };

/** The CLI reports Go's `runtime.GOOS`/`GOARCH` names. */
export function userAgent(
	platform: string = process.platform,
	arch: string = process.arch,
): string {
	const os = GO_OS[platform] ?? platform;
	const goArch = GO_ARCH[arch] ?? arch;
	return `antigravity/cli/${AGY_VERSION} (aidev_client; os_type=${os}; arch=${goArch}; cl=${AGY_CHANGE_LIST}; auth_method=consumer)`;
}

/** The CLI's JSON request headers; fetch adds `Host` and the body framing. */
export function cliHeaders(accessToken?: string): Record<string, string> {
	return {
		"User-Agent": userAgent(),
		...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
		"Content-Type": "application/json",
		"Accept-Encoding": "gzip",
	};
}

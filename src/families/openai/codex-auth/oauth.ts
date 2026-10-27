/** Owns legacy Codex device and localhost browser OAuth login, without Pi model registration. */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { createPkce, randomState } from "../../../core/auth/pkce.ts";
import { credentialPath, lockedCredential, writeCredential } from "./store.ts";
import { CLIENT_ID, exchange, post } from "./tokens.ts";
import { CodexAuthError, type CodexCredential, type CodexOptions, record, text } from "./types.ts";

const DEVICE_INIT = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_TOKEN = "https://auth.openai.com/api/accounts/deviceauth/token";
const DEVICE_REDIRECT = "https://auth.openai.com/deviceauth/callback";
const DEVICE_PAGE = "https://auth.openai.com/codex/device";
const CALLBACK_URI = "http://localhost:1455/auth/callback";

/** Selects the legacy Codex flow and receives user-facing authorization instructions. */
export interface CodexLoginOptions extends CodexOptions {
	readonly mode: "auto" | "browser" | "device";
	readonly onStatus: (message: string) => void;
}

async function device(options: CodexLoginOptions): Promise<CodexCredential> {
	options.onStatus("Requesting Codex device authorization code…");
	const init = record(await post(DEVICE_INIT, { client_id: CLIENT_ID }, options));
	const deviceId = text(init["device_auth_id"]);
	const userCode = text(init["user_code"]);
	const interval = init["interval"];
	const seconds =
		interval === undefined
			? 5
			: typeof interval === "string" || typeof interval === "number"
				? Number(interval)
				: Number.NaN;
	if (
		!deviceId ||
		!userCode ||
		!Number.isFinite(seconds) ||
		seconds < 0 ||
		seconds * 1000 + 3000 > 2_147_483_647
	) {
		throw new CodexAuthError("invalid device authorization response", DEVICE_INIT);
	}
	const pollMs = seconds * 1000 + 3000;
	options.onStatus(`Open ${DEVICE_PAGE} and enter code: ${userCode}`);
	for (let attempt = 0; attempt < 120; attempt++) {
		await delay(attempt === 0 ? Math.min(pollMs, 5000) : pollMs, undefined, {
			signal: options.signal,
		});
		let value: unknown;
		try {
			value = await post(DEVICE_TOKEN, { device_auth_id: deviceId, user_code: userCode }, options);
		} catch (error) {
			if (error instanceof CodexAuthError && (error.status === 403 || error.status === 404))
				continue;
			throw error;
		}
		const data = record(value);
		const code = text(data["authorization_code"]);
		const verifier = text(data["code_verifier"]);
		if (!code || !verifier) throw new CodexAuthError("invalid device token response", DEVICE_TOKEN);
		options.onStatus("Exchanging device authorization code for Codex tokens…");
		return exchange(
			{
				grant_type: "authorization_code",
				code,
				code_verifier: verifier,
				redirect_uri: DEVICE_REDIRECT,
			},
			options,
		);
	}
	throw new CodexAuthError("device login timed out", DEVICE_TOKEN);
}

function openBrowser(url: string, onStatus: (message: string) => void): void {
	const command =
		process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
	try {
		const child = spawn(command, process.platform === "win32" ? ["/c", "start", "", url] : [url], {
			stdio: "ignore",
			detached: true,
		});
		child.on("error", () =>
			onStatus("Could not open a browser automatically; open the authorization URL manually."),
		);
		child.unref();
	} catch {
		onStatus("Could not open a browser automatically; open the authorization URL manually.");
	}
}

async function browser(options: CodexLoginOptions): Promise<CodexCredential> {
	const { verifier, challenge } = await createPkce();
	const state = randomState();
	const url = new URL("https://auth.openai.com/oauth/authorize");
	url.search = new URLSearchParams({
		response_type: "code",
		client_id: CLIENT_ID,
		redirect_uri: CALLBACK_URI,
		scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
		code_challenge: challenge,
		code_challenge_method: "S256",
		state,
		id_token_add_organizations: "true",
		codex_cli_simplified_flow: "true",
		originator: "codex_cli_rs",
	}).toString();
	const signal = AbortSignal.any([
		...(options.signal ? [options.signal] : []),
		AbortSignal.timeout(300_000),
	]);
	signal.throwIfAborted();
	const code = await new Promise<string>((resolve, reject) => {
		const server = createServer((req, res) => {
			let callback: URL;
			try {
				callback = new URL(req.url ?? "/", CALLBACK_URI);
			} catch {
				res.writeHead(400).end("Invalid callback URL");
				return;
			}
			if (callback.pathname !== "/auth/callback") {
				res.writeHead(404).end("Not found");
				return;
			}
			const code = callback.searchParams.get("code");
			if (
				callback.searchParams.has("error") ||
				!code ||
				callback.searchParams.get("state") !== state
			) {
				res.writeHead(400).end("Codex authentication failed. You may close this window.");
				finish(new CodexAuthError("invalid authorization callback or state", CALLBACK_URI));
				return;
			}
			res
				.writeHead(200)
				.end("Codex authentication succeeded. You may close this window and return to Pi.");
			finish(undefined, code);
		});
		function finish(error?: CodexAuthError, code?: string): void {
			signal.removeEventListener("abort", abort);
			server.close();
			server.closeAllConnections();
			if (error) reject(error);
			else if (code) resolve(code);
		}
		function abort(): void {
			finish(new CodexAuthError("browser login cancelled or timed out", CALLBACK_URI));
		}
		signal.addEventListener("abort", abort, { once: true });
		server.once("error", () =>
			finish(new CodexAuthError("callback server unavailable", CALLBACK_URI)),
		);
		server.listen(1455, "127.0.0.1", () => {
			if (signal.aborted) {
				abort();
				return;
			}
			options.onStatus(`Open in browser: ${url}`);
			openBrowser(url.toString(), options.onStatus);
		});
	});
	return exchange(
		{ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: CALLBACK_URI },
		options,
	);
}

/** Logs in with the legacy Codex client and atomically stores the credential under lock. */
export async function loginCodex(options: CodexLoginOptions): Promise<CodexCredential> {
	options.signal?.throwIfAborted();
	const signal = AbortSignal.any([
		...(options.signal ? [options.signal] : []),
		AbortSignal.timeout(900_000),
	]);
	const deps = { ...options, signal };
	const headless =
		Boolean(process.env["SSH_CONNECTION"] || process.env["SSH_TTY"]) &&
		!process.env["DISPLAY"] &&
		!process.env["WAYLAND_DISPLAY"];
	let credential: CodexCredential;
	if (options.mode === "device" || (options.mode === "auto" && headless))
		credential = await device(deps);
	else {
		try {
			credential = await browser(deps);
		} catch (error) {
			signal.throwIfAborted();
			if (
				options.mode !== "auto" ||
				!(error instanceof CodexAuthError) ||
				error.operation !== "callback server unavailable"
			)
				throw error;
			options.onStatus("Local callback server unavailable; using Codex device login.");
			credential = await device(deps);
		}
	}
	const path = credentialPath(options.path);
	await lockedCredential(path, async () => {
		signal.throwIfAborted();
		await writeCredential(path, credential);
	});
	return credential;
}

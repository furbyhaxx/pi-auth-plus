/** Owns Codex token payload parsing, JWT profile hints, and OAuth exchanges. */
import { ProviderHttpError, request } from "../../../core/http/index.ts";
import { CodexAuthError, type CodexCredential, type CodexOptions, record, text } from "./types.ts";

export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const TOKEN_URL = "https://auth.openai.com/oauth/token";

function claims(token: string | undefined): Record<string, unknown> {
	const parts = token?.split(".");
	if (parts?.length !== 3 || !parts[1]) return {};
	try {
		return record(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
	} catch {
		return {};
	}
}

export function profile(
	access: string,
	id?: string,
): Pick<CodexCredential, "accountId" | "email" | "planType"> {
	const accessClaims = claims(access);
	const idClaims = claims(id);
	const auth = record(accessClaims["https://api.openai.com/auth"]);
	const idAuth = record(idClaims["https://api.openai.com/auth"]);
	const accountId = text(auth["chatgpt_account_id"]) ?? text(idAuth["chatgpt_account_id"]);
	const email =
		text(record(accessClaims["https://api.openai.com/profile"])["email"]) ??
		text(record(idClaims["https://api.openai.com/profile"])["email"]);
	const planType = text(auth["chatgpt_plan_type"]) ?? text(idAuth["chatgpt_plan_type"]);
	return {
		...(accountId ? { accountId } : {}),
		...(email ? { email: email.trim().toLowerCase() } : {}),
		...(planType ? { planType: planType.trim().toLowerCase() } : {}),
	};
}

export async function post(
	url: string,
	body: URLSearchParams | Record<string, string>,
	options: CodexOptions,
): Promise<unknown> {
	options.signal?.throwIfAborted();
	try {
		const response = await request(url, {
			provider: "codex",
			fetch: options.fetch ?? fetch,
			now: options.now ?? Date.now,
			...(options.signal ? { signal: options.signal } : {}),
			timeoutMs: 15_000,
			method: "POST",
			headers: {
				"Content-Type":
					body instanceof URLSearchParams
						? "application/x-www-form-urlencoded"
						: "application/json",
			},
			body: body instanceof URLSearchParams ? body.toString() : JSON.stringify(body),
			secrets: [...(body instanceof URLSearchParams ? body.values() : Object.values(body))],
		});
		const value: unknown = await response.json();
		options.signal?.throwIfAborted();
		return value;
	} catch (error) {
		options.signal?.throwIfAborted();
		throw new CodexAuthError(
			"OAuth request failed",
			url,
			error instanceof ProviderHttpError ? error.status : undefined,
		);
	}
}

export async function exchange(
	body: Record<string, string>,
	options: CodexOptions,
	previous?: CodexCredential,
): Promise<CodexCredential> {
	const data = record(
		await post(TOKEN_URL, new URLSearchParams({ client_id: CLIENT_ID, ...body }), options),
	);
	const access = text(data["access_token"]);
	const refresh = text(data["refresh_token"]) ?? previous?.refresh;
	const lifetime = data["expires_in"];
	if (
		!access ||
		!refresh ||
		(lifetime !== undefined &&
			(typeof lifetime !== "number" || !Number.isFinite(lifetime) || lifetime <= 0))
	) {
		throw new CodexAuthError("invalid token response", TOKEN_URL);
	}
	const exp = claims(access)["exp"];
	const now = (options.now ?? Date.now)();
	const expires =
		typeof lifetime === "number"
			? now + lifetime * 1000
			: typeof exp === "number" && Number.isFinite(exp)
				? exp * 1000
				: now + 3_600_000;
	if (!Number.isFinite(expires)) throw new CodexAuthError("invalid token expiry", TOKEN_URL);
	const hints = profile(access, text(data["id_token"]));
	return {
		type: "oauth",
		access,
		refresh,
		expires,
		...((hints.accountId ?? previous?.accountId)
			? { accountId: hints.accountId ?? previous?.accountId }
			: {}),
		...((hints.email ?? previous?.email) ? { email: hints.email ?? previous?.email } : {}),
		...((hints.planType ?? previous?.planType)
			? { planType: hints.planType ?? previous?.planType }
			: {}),
	};
}

/** Best-effort preservation of group context limits across physical routing. */

const marker = Symbol.for("pi-auth-plus.group-context-cap");

function positive(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function groupLimit(model: unknown): number | undefined {
	if (
		typeof model !== "object" ||
		model === null ||
		!("provider" in model) ||
		model.provider !== "group" ||
		!("api" in model) ||
		model.api !== "pi-virtual" ||
		!("contextWindow" in model) ||
		!positive(model.contextWindow)
	)
		return undefined;
	return model.contextWindow;
}

function capRoute(route: unknown, limit: number): unknown {
	try {
		if (typeof route !== "object" || route === null || !("model" in route)) return route;
		const model = route.model;
		if (
			typeof model !== "object" ||
			model === null ||
			!("contextWindow" in model) ||
			!positive(model.contextWindow)
		)
			return route;
		return { ...route, model: { ...model, contextWindow: Math.min(limit, model.contextWindow) } };
	} catch {
		return route;
	}
}

/** Install a guarded wrapper around Pi's private model runtime when available. */
export function installGroupContextCap(registry: unknown): boolean {
	try {
		if (typeof registry !== "object" || registry === null || !("runtime" in registry)) return false;
		const runtime: unknown = registry.runtime;
		if (typeof runtime !== "object" || runtime === null || !("resolveModel" in runtime))
			return false;
		const original: unknown = runtime.resolveModel;
		if (typeof original !== "function") return false;
		if (Reflect.get(original, marker) === true) return true;
		const wrapped = function (this: unknown, ...args: unknown[]) {
			const result: unknown = Reflect.apply(original, this, args);
			let limit: number | undefined;
			try {
				limit = groupLimit(args[0]);
			} catch {
				return result;
			}
			return limit === undefined
				? result
				: Promise.resolve(result).then((route) => capRoute(route, limit));
		};
		Object.defineProperty(wrapped, marker, { value: true });
		return Reflect.set(runtime, "resolveModel", wrapped) && runtime.resolveModel === wrapped;
	} catch {
		return false;
	}
}

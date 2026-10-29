/** Serializes session-owned settings persistence and its effects. */
import { type AppSettings, SETTINGS } from "./catalog.ts";
import type { Changes, SaveScope, SettingsSaveResult } from "./index.ts";

/** Staged catalog values, with null removing a scoped value. */
export type SettingsChanges = Changes<typeof SETTINGS>;

/** Whether persistence committed, including any shadowing and post-save warnings. */
export type SaveOutcome =
	| { readonly committed: false; readonly error: string }
	| {
			readonly committed: true;
			readonly scope: SaveScope;
			readonly shadowed: readonly string[];
			readonly warnings: readonly string[];
	  };

/** Saves a snapshot of staged changes to one scope. */
export type SettingsSaver = (scope: SaveScope, changes: SettingsChanges) => Promise<SaveOutcome>;

/** Captures each owner immediately and serializes saves through completion of their effects. */
export function createSettingsSaver(
	capture: () => {
		store: AppSettings;
		signal: AbortSignal;
		apply: (keys: readonly string[], scope: SaveScope) => Promise<readonly string[]>;
	},
): SettingsSaver {
	let pending: Promise<void> = Promise.resolve();
	return async (scope, changes) => {
		const { store, signal, apply } = capture();
		const snapshot = structuredClone(changes);
		const previous = pending;
		const { promise, resolve } = Promise.withResolvers<void>();
		pending = promise;
		await previous;
		try {
			if (signal.aborted) {
				return { committed: false, error: "Settings save cancelled because the session ended" };
			}
			let result: SettingsSaveResult;
			try {
				result = await store.save(scope, snapshot);
			} catch (error) {
				return { committed: false, error: error instanceof Error ? error.message : String(error) };
			}
			const keys = Object.keys(snapshot).filter((key): key is keyof typeof SETTINGS =>
				Object.hasOwn(SETTINGS, key),
			);
			const shadowed = store.shadowed(scope, keys);
			const warnings: string[] = [...result.warnings];
			if (signal.aborted) {
				warnings.push(
					"Session ended before settings effects could run; reopen the session to apply them",
				);
			} else {
				try {
					warnings.push(...(await apply(keys, scope)));
				} catch (error) {
					const reason = error instanceof Error ? error.message : String(error);
					warnings.push(`Settings effects failed: ${reason}; retry or reopen the session`);
				}
				if (signal.aborted) {
					warnings.push("Session ended while applying settings; some effects may be incomplete");
				}
			}
			return { committed: true, scope, shadowed, warnings };
		} finally {
			resolve();
		}
	};
}

/** Formats the save result, including every shadowed key and warning. */
export function formatSaveOutcome(outcome: SaveOutcome): string {
	if (!outcome.committed) return outcome.error;
	return [
		`Saved to ${outcome.scope} scope`,
		...(outcome.shadowed.length > 0
			? [`shadowed by higher scope: ${outcome.shadowed.join(", ")}`]
			: []),
		...outcome.warnings.map((warning) => `warning: ${warning}`),
	].join("; ");
}

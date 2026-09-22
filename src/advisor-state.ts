import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const SESSION_MODEL_VALUE = "__session__";

export type AdvisorConfig = {
	modelKey?: string;
	effort?: ModelThinkingLevel;
};

export function modelKey(m: { provider: string; id: string }): string {
	return `${m.provider}/${m.id}`;
}

function configPath(): string {
	const xdg = process.env.XDG_CONFIG_HOME?.trim();
	const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".config");
	return join(base, "pi-advisor", "config.json");
}

export function loadAdvisorConfig(): AdvisorConfig {
	const path = configPath();
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const cfg: AdvisorConfig = {};
		if (typeof parsed.modelKey === "string" && parsed.modelKey) cfg.modelKey = parsed.modelKey;
		if (typeof parsed.effort === "string" && parsed.effort) cfg.effort = parsed.effort as ModelThinkingLevel;
		return cfg;
	} catch {
		return {};
	}
}

export function saveAdvisorConfig(modelKeyValue: string | undefined, effort: ModelThinkingLevel | undefined): boolean {
	const path = configPath();
	const next: AdvisorConfig = {};
	if (modelKeyValue) next.modelKey = modelKeyValue;
	if (effort) next.effort = effort;
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
		try {
			chmodSync(path, 0o600);
		} catch {}
		return true;
	} catch {
		return false;
	}
}

let selectedModelKey: string | undefined;
let selectedEffort: ModelThinkingLevel | undefined;
let loaded = false;
// Cache the registry lookup per modelKey: repeated consult() calls in one session
// skip the getAvailable() scan after the first hit.
let resolvedCacheKey: string | undefined;
let resolvedCacheModel: Model<Api> | undefined;

function ensureLoaded(): void {
	if (loaded) return;
	const cfg = loadAdvisorConfig();
	selectedModelKey = cfg.modelKey;
	selectedEffort = cfg.effort;
	loaded = true;
}

export function getAdvisorModelKey(): string | undefined {
	ensureLoaded();
	return selectedModelKey;
}

export function getAdvisorEffort(): ModelThinkingLevel | undefined {
	ensureLoaded();
	return selectedEffort;
}

export function setAdvisorSelection(modelKeyValue: string | undefined, effort: ModelThinkingLevel | undefined): void {
	selectedModelKey = modelKeyValue;
	selectedEffort = effort;
}

export function resetAdvisorSelectionForTests(): void {
	selectedModelKey = undefined;
	selectedEffort = undefined;
	loaded = true;
	resolvedCacheKey = undefined;
	resolvedCacheModel = undefined;
}

export function resolveAdvisorModel(ctx: ExtensionContext): {
	model: Model<Api>;
	thinkingLevel?: ModelThinkingLevel;
} | null {
	ensureLoaded();
	if (!selectedModelKey || selectedModelKey === SESSION_MODEL_VALUE) {
		if (!ctx.model) return null;
		return {
			model: ctx.model as Model<Api>,
			thinkingLevel: ctx.thinkingLevel as ModelThinkingLevel | undefined,
		};
	}
	const found =
		resolvedCacheKey === selectedModelKey && resolvedCacheModel
			? resolvedCacheModel
			: ctx.modelRegistry.getAvailable().find((m) => modelKey(m) === selectedModelKey);
	if (found && resolvedCacheKey !== selectedModelKey) {
		resolvedCacheKey = selectedModelKey;
		resolvedCacheModel = found as Model<Api>;
	}
	if (found) return { model: found as Model<Api>, thinkingLevel: selectedEffort };
	if (!ctx.model) return null;
	return {
		model: ctx.model as Model<Api>,
		thinkingLevel: ctx.thinkingLevel as ModelThinkingLevel | undefined,
	};
}

import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	ModelThinkingLevel,
	ProviderHeaders,
	ProviderStreamOptions,
} from "@earendil-works/pi-ai";

export const SYSTEM_PROMPT =
	"You are the advisor. The executor brings one focused question with minimal facts. " +
	"Answer with exactly one: a plan (concrete next steps), a correction (wrong path, redirect), " +
	"or a stop signal (halt and escalate to the user). " +
	"Advisor principles: ground every claim in the question alone, never invent files, facts, or history; " +
	"mark each claim as known, inferred, or unknown; " +
	"recommend the simplest sufficient action; " +
	"close with the single check that would disprove your guidance. " +
	"Be concise and directive. Name files, functions, and line numbers. No preamble, no apologies.";

export const MAX_QUESTION_CHARS = 4000;
export const MAX_CONTEXT_CHARS = 2000;

export type AdvisorModel = Model<Api>;

export interface AdvisorAuth {
	apiKey?: string;
	headers?: ProviderHeaders;
	env?: Record<string, string>;
}

export type AdvisorResponse = Pick<AssistantMessage, "content" | "stopReason" | "errorMessage">;

export type Complete = (
	model: AdvisorModel,
	context: Context,
	options: ProviderStreamOptions,
) => Promise<AdvisorResponse>;

export interface AdvisorDependencies {
	complete: Complete;
	resolveAuth(model: AdvisorModel): Promise<AdvisorAuth>;
}

export function truncate(text: string, max: number): string {
	const t = text.trim();
	if (t.length <= max) return t;
	return `${t.slice(0, max)}\n…[truncated ${t.length - max} chars]`;
}

export function buildAdvisorContext(question: string, context?: string): Context {
	const q = truncate(question, MAX_QUESTION_CHARS);
	const parts =
		context && context.trim().length > 0 ? `${q}\n\n--- context ---\n${truncate(context, MAX_CONTEXT_CHARS)}` : q;
	return {
		systemPrompt: SYSTEM_PROMPT,
		messages: [
			{
				role: "user",
				content: [{ type: "text", text: parts }],
				timestamp: Date.now(),
			},
		],
	};
}

export async function consult(
	rawQuestion: string,
	rawContext: string | undefined,
	model: AdvisorModel,
	dependencies: AdvisorDependencies,
	signal?: AbortSignal,
	thinkingLevel?: ModelThinkingLevel,
): Promise<string | null> {
	const question = rawQuestion.trim();
	if (!question) {
		throw new Error("Cannot consult the advisor with an empty question");
	}
	const context = rawContext?.trim() ? rawContext : undefined;

	const auth = await dependencies.resolveAuth(model);
	const response = await dependencies.complete(model, buildAdvisorContext(question, context), {
		apiKey: auth.apiKey,
		headers: auth.headers,
		env: auth.env,
		signal,
		...(thinkingLevel ? { reasoning: thinkingLevel } : {}),
	});

	if (response.stopReason === "aborted") {
		return null;
	}

	if (response.stopReason === "error") {
		throw new Error(response.errorMessage ?? "Advisor call failed");
	}

	const text = response.content
		.filter((c): c is Extract<AssistantMessage["content"][number], { type: "text" }> => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();

	if (!text) {
		throw new Error("Advisor returned empty text");
	}
	return text;
}

export function createAdvisorDependencies(ctx: {
	modelRegistry: {
		getApiKeyAndHeaders: (m: AdvisorModel) => Promise<{
			ok: boolean;
			error?: string;
			apiKey?: string;
			headers?: ProviderHeaders;
			env?: Record<string, string>;
		}>;
	};
}): AdvisorDependencies {
	let completePromise: Promise<{ completeSimple: CompleteSimpleFn }> | undefined;
	return {
		complete: async (model, context, options) => {
			// Cache the loader per session: dynamic import() resolves once,
			// every later consult() reuses it with zero module-resolution cost.
			completePromise ??= loadComplete(modelRegistryOf(ctx));
			const { completeSimple } = await completePromise;
			return completeSimple(model, { ...context, tools: [] }, options);
		},
		resolveAuth: async (model) => {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) throw new Error(auth.error);
			return { apiKey: auth.apiKey, headers: auth.headers, env: auth.env };
		},
	};
}

function modelRegistryOf(ctx: { modelRegistry: unknown }): unknown {
	return ctx.modelRegistry;
}

type CompleteSimpleFn = (
	model: AdvisorModel,
	context: Context & { tools: [] },
	options: ProviderStreamOptions,
) => Promise<AdvisorResponse>;

function runtimeCompleteSimple(modelRegistry: unknown): CompleteSimpleFn | undefined {
	try {
		if (modelRegistry === null || typeof modelRegistry !== "object") return undefined;
		const runtime = (modelRegistry as { runtime?: unknown }).runtime;
		if (runtime === null || typeof runtime !== "object") return undefined;
		const fn = (runtime as { completeSimple?: unknown }).completeSimple;
		return typeof fn === "function" ? (fn as CompleteSimpleFn).bind(runtime) : undefined;
	} catch {
		return undefined;
	}
}

const MODULE_NOT_FOUND_CODES = new Set(["ERR_PACKAGE_PATH_NOT_EXPORTED", "ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"]);

function isModuleNotFound(err: unknown): boolean {
	for (
		let cur: unknown = err, depth = 0;
		cur != null && depth < 16;
		cur = (cur as { cause?: unknown }).cause, depth++
	) {
		if (typeof cur === "object" && MODULE_NOT_FOUND_CODES.has((cur as { code?: unknown }).code as string)) {
			return true;
		}
	}
	return false;
}

async function loadComplete(modelRegistry: unknown): Promise<{ completeSimple: CompleteSimpleFn }> {
	const runtime = runtimeCompleteSimple(modelRegistry);
	if (runtime) return { completeSimple: runtime };
	try {
		const mod = (await import("@earendil-works/pi-ai/compat")) as {
			completeSimple?: CompleteSimpleFn;
		};
		if (typeof mod.completeSimple !== "function") {
			throw new Error("pi-ai /compat does not expose completeSimple");
		}
		return { completeSimple: mod.completeSimple };
	} catch (err) {
		if (!isModuleNotFound(err)) throw err;
		let mod: { completeSimple?: CompleteSimpleFn };
		try {
			mod = (await import("@earendil-works/pi-ai")) as {
				completeSimple?: CompleteSimpleFn;
			};
		} catch (importErr) {
			throw new Error("pi-ai does not expose completeSimple — unsupported host version", { cause: importErr });
		}
		if (typeof mod.completeSimple !== "function") {
			throw new Error("pi-ai does not expose completeSimple — unsupported host version", { cause: err });
		}
		return { completeSimple: mod.completeSimple };
	}
}

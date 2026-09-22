import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type AdvisorModel, consult, createAdvisorDependencies } from "../src/advisor.ts";
import { resolveAdvisorModel } from "../src/advisor-state.ts";

const AdvisorParams = Type.Object({
	question: Type.String({
		description: "One focused question for the advisor. Include the decision, the options, and what is at stake.",
	}),
	context: Type.Optional(
		Type.String({
			description: "Minimal extra context (a few lines: file paths, error text, or constraints). Omit history.",
		}),
	),
});

const DESCRIPTION =
	"Consult the advisor with one focused question. " +
	"Pass `question` with the decision plus options, and optional `context` with a few lines only. " +
	"Do NOT paste history — the advisor answers from the question alone.";

const SNIPPET =
	"Consult the advisor with one focused question when stuck, before substantive work, or before declaring done";
const GUIDELINES: string[] = [
	"Call `advisor` with ONE question — the decision, the options, what is at stake. Keep it under a paragraph.",
	"Put only the minimum extra facts in `context` (file paths, error text, constraints). Never paste history or tool output dumps.",
	"Call before committing to an approach and before declaring done. On short reactive tasks where the next action is dictated by tool output, skip the call.",
	"Give the answer serious weight. If a step fails empirically or primary-source evidence contradicts it, adapt — a passing self-test alone is not a contradiction.",
	"After each answer, restate the key guidance in your next visible reply before continuing.",
];

function toModel(ctx: ExtensionContext): { model: AdvisorModel; thinkingLevel?: ModelThinkingLevel } | null {
	const resolved = resolveAdvisorModel(ctx);
	if (resolved)
		return resolved as {
			model: AdvisorModel;
			thinkingLevel?: ModelThinkingLevel;
		};
	if (ctx.model) {
		return {
			model: ctx.model as AdvisorModel,
			thinkingLevel: ctx.thinkingLevel as ModelThinkingLevel | undefined,
		};
	}
	return null;
}

export default function registerAdvisorTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "advisor",
		label: "Advisor",
		description: DESCRIPTION,
		promptSnippet: SNIPPET,
		promptGuidelines: GUIDELINES,
		parameters: AdvisorParams,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const question = (params as { question?: unknown }).question;
			const context = (params as { context?: unknown }).context;
			if (typeof question !== "string" || !question.trim()) {
				return {
					content: [
						{
							type: "text",
							text: "Advisor needs one focused question — retry advisor() with `question` set.",
						},
					],
					details: { errorMessage: "empty question" },
				};
			}
			const resolved = toModel(ctx);
			if (!resolved) {
				return {
					content: [
						{
							type: "text",
							text: "No advisor model is configured. Run /advisor to pick one.",
						},
					],
					details: { errorMessage: "no advisor model" },
				};
			}
			const label = `${resolved.model.provider}/${resolved.model.id}`;
			onUpdate?.({
				content: [{ type: "text", text: `Consulting advisor (${label})…` }],
				details: { advisorModel: label },
			});
			try {
				const answer = await consult(
					question,
					typeof context === "string" ? context : undefined,
					resolved.model,
					createAdvisorDependencies(ctx),
					signal ?? undefined,
					resolved.thinkingLevel,
				);
				if (answer === null) {
					return {
						content: [
							{
								type: "text",
								text: "Advisor call was cancelled before it completed.",
							},
						],
						details: { advisorModel: label, errorMessage: "aborted" },
					};
				}
				return {
					content: [{ type: "text", text: answer }],
					details: { advisorModel: label },
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Advisor call failed: ${message}` }],
					details: { advisorModel: label, errorMessage: message },
				};
			}
		},
	});

	// codemode's "only" mode hides the advisor declaration, so pi drops this tool's
	// per-tool guidelines from the <rules> section. Re-add them as prompt guidelines.
	pi.on("before_agent_start", (event) => {
		const options = event.systemPromptOptions;
		// hiddenTools exists on newer pi; older versions have no "only" mode.
		const hiddenTools = (options as typeof options & { hiddenTools?: string[] }).hiddenTools ?? [];
		if (!options.selectedTools?.includes("advisor") || !hiddenTools.includes("advisor")) return;
		options.promptGuidelines ??= [];
		for (const rule of GUIDELINES) {
			if (!options.promptGuidelines.includes(rule)) options.promptGuidelines.push(rule);
		}
	});
}

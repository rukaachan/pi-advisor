import assert from "node:assert/strict";
import test from "node:test";
import registerAdvisorTool from "../extensions/advisor-tool.ts";
import { resetAdvisorSelectionForTests, setAdvisorSelection } from "../src/advisor-state.ts";

interface ToolDef {
	name: string;
	execute: (
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: ((u: unknown) => void) | undefined,
		ctx: never,
	) => Promise<{ content: Array<{ type: string; text: string }>; details?: Record<string, unknown> }>;
}

function captureTool(): ToolDef {
	let def: ToolDef | undefined;
	registerAdvisorTool({
		registerTool: (d: ToolDef) => {
			def = d;
		},
		on: () => () => {},
	} as never);
	assert.ok(def);
	return def as ToolDef;
}

function sessionCtx(overrides: Record<string, unknown> = {}): never {
	return {
		model: { provider: "p", id: "s", name: "session" },
		thinkingLevel: undefined,
		modelRegistry: {
			getAvailable: () => [],
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }),
			runtime: {
				completeSimple: async () => ({
					stopReason: "stop",
					content: [{ type: "text", text: "Split it." }],
				}),
			},
		},
		...overrides,
	} as never;
}

test("advisor tool executes through the real consult path", async () => {
	resetAdvisorSelectionForTests();
	setAdvisorSelection(undefined, undefined);
	const def = captureTool();
	const updates: unknown[] = [];
	const res = await def.execute(
		"id",
		{ question: "Split or keep?" },
		undefined,
		(u) => updates.push(u),
		sessionCtx(),
	);
	assert.match(res.content[0].text, /Split/);
	assert.equal(updates.length, 1);
	resetAdvisorSelectionForTests();
});

test("advisor tool forwards context to the model call", async () => {
	resetAdvisorSelectionForTests();
	setAdvisorSelection(undefined, undefined);
	const def = captureTool();
	let seen = "";
	const ctx = sessionCtx({
		modelRegistry: {
			getAvailable: () => [],
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }),
			runtime: {
				completeSimple: async (_m: unknown, c: { messages: Array<{ content: Array<{ text: string }> }> }) => {
					seen = c.messages[0].content[0].text;
					return { stopReason: "stop", content: [{ type: "text", text: "ok" }] };
				},
			},
		},
	});
	await def.execute("id", { question: "Split or keep?", context: "src/main.ts" }, undefined, undefined, ctx);
	assert.match(seen, /src\/main\.ts/);
	resetAdvisorSelectionForTests();
});

test("empty question fails closed with no model call", async () => {
	const def = captureTool();
	let called = false;
	const ctx = sessionCtx({
		modelRegistry: {
			getAvailable: () => [],
			getApiKeyAndHeaders: async () => {
				called = true;
				return { ok: true, apiKey: "k" };
			},
		},
	});
	const res = await def.execute("id", { question: "   " }, undefined, undefined, ctx);
	assert.match(res.content[0].text, /one focused question/);
	assert.equal(called, false);
});

test("missing model fails with configuration guidance", async () => {
	const def = captureTool();
	const ctx = {
		model: undefined,
		thinkingLevel: undefined,
		modelRegistry: { getAvailable: () => [] },
	} as never;
	const res = await def.execute("id", { question: "Split or keep?" }, undefined, undefined, ctx);
	assert.match(res.content[0].text, /\/advisor/);
});

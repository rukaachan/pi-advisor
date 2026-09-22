import assert from "node:assert/strict";
import test from "node:test";
import {
	type AdvisorModel,
	type AdvisorResponse,
	buildAdvisorContext,
	consult,
	MAX_CONTEXT_CHARS,
	MAX_QUESTION_CHARS,
	SYSTEM_PROMPT,
	truncate,
} from "../src/advisor.ts";

const model = {} as AdvisorModel;

function response(text: string): AdvisorResponse {
	return {
		stopReason: "stop",
		content: [{ type: "text", text }],
	};
}

test("focused question sends one message, no history dump", async () => {
	let received: ReturnType<typeof buildAdvisorContext> | undefined;
	let receivedOptions: Record<string, unknown> | undefined;
	const signal = new AbortController().signal;

	const result = await consult(
		"Should I split parser.ts or keep one file? Options: split vs keep. At stake: public API stability.",
		"src/parser.ts, 900 lines",
		model,
		{
			resolveAuth: async () => ({ apiKey: "test-key" }),
			complete: async (_model, context, options) => {
				received = context;
				receivedOptions = options;
				return response("Keep one file; extract helpers first.");
			},
		},
		signal,
	);

	assert.equal(result, "Keep one file; extract helpers first.");
	assert.ok(received);
	assert.equal(received.systemPrompt, SYSTEM_PROMPT);
	assert.equal(received.messages.length, 1);
	assert.equal(receivedOptions?.apiKey, "test-key");
	assert.equal(receivedOptions?.signal, signal);
	const text = (received.messages[0].content[0] as { text: string }).text;
	assert.match(text, /Should I split parser\.ts/);
	assert.match(text, /src\/parser\.ts/);
});

test("long question and context are bounded", async () => {
	const ctx = buildAdvisorContext("q".repeat(MAX_QUESTION_CHARS + 100), "c".repeat(MAX_CONTEXT_CHARS + 100));
	const text = (ctx.messages[0].content[0] as { text: string }).text;
	assert.match(text, /truncated/);
	assert.ok(text.length < MAX_QUESTION_CHARS + MAX_CONTEXT_CHARS + 500);
});

test("truncate keeps short text intact", () => {
	assert.equal(truncate("  hello  ", 100), "hello");
});

test("empty question fails closed", async () => {
	await assert.rejects(
		consult("   ", undefined, model, {
			resolveAuth: async () => ({}),
			complete: async () => response("x"),
		}),
		/empty question/,
	);
});

test("aborted request returns null", async () => {
	const result = await consult("decide X or Y?", undefined, model, {
		resolveAuth: async () => ({}),
		complete: async () => ({ stopReason: "aborted", content: [] }),
	});
	assert.equal(result, null);
});

test("empty model output fails closed", async () => {
	await assert.rejects(
		consult("decide X or Y?", undefined, model, {
			resolveAuth: async () => ({}),
			complete: async () => response("   "),
		}),
		/empty text/,
	);
});

test("provider errors surface", async () => {
	await assert.rejects(
		consult("decide X or Y?", undefined, model, {
			resolveAuth: async () => ({}),
			complete: async () => ({
				stopReason: "error",
				content: [],
				errorMessage: "down",
			}),
		}),
		/down/,
	);
});

test("repeated consult() calls reuse one context shape (no per-call growth)", async () => {
	let calls = 0;
	const sizes: number[] = [];
	const deps = {
		resolveAuth: async () => ({}),
		complete: async (_model: AdvisorModel, context: ReturnType<typeof buildAdvisorContext>) => {
			calls += 1;
			sizes.push(JSON.stringify(context).length);
			return response(`answer ${calls}`);
		},
	};
	// Sequential on purpose: asserts stable context size across ordered calls.
	for (let i = 0; i < 3; i++) {
		await consult("Same question repeated?", "same facts", model, deps);
	}
	assert.equal(calls, 3);
	assert.equal(sizes[0], sizes[1]);
	assert.equal(sizes[1], sizes[2]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { testFilterItems } from "../src/advisor-ui.ts";

const items = [
	{ value: "a", label: "Use session model" },
	{ value: "b", label: "Muse Spark (opencode-zen)" },
	{ value: "c", label: "GPT 5 (openai)" },
];

test("empty query keeps original order", () => {
	assert.deepEqual(
		testFilterItems(items, "").map((i) => i.value),
		["a", "b", "c"],
	);
});

test("fuzzy filter ranks the real match first", () => {
	const out = testFilterItems(items, "spark");
	assert.equal(out[0].value, "b");
});

test("provider-qualified query matches by value", () => {
	const out = testFilterItems(items, "openai");
	assert.ok(out.some((i) => i.value === "c"));
});

test("no match returns empty list", () => {
	assert.equal(testFilterItems(items, "zzz-nope").length, 0);
});

test("filter never mutates the input order", () => {
	const before = items.map((i) => i.value);
	testFilterItems(items, "spark");
	assert.deepEqual(
		items.map((i) => i.value),
		before,
	);
});

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	loadAdvisorConfig,
	resetAdvisorSelectionForTests,
	resolveAdvisorModel,
	saveAdvisorConfig,
	setAdvisorSelection,
} from "../src/advisor-state.ts";

function withTempConfigHome(fn: (dir: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "pi-advisor-"));
	const prev = process.env.XDG_CONFIG_HOME;
	process.env.XDG_CONFIG_HOME = dir;
	resetAdvisorSelectionForTests();
	try {
		fn(dir);
	} finally {
		if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = prev;
		rmSync(dir, { recursive: true, force: true });
		resetAdvisorSelectionForTests();
	}
}

test("config roundtrips through real fs", () => {
	withTempConfigHome((dir) => {
		assert.equal(saveAdvisorConfig("test-provider/test-model", "low"), true);
		const raw = JSON.parse(readFileSync(join(dir, "pi-advisor", "config.json"), "utf-8")) as Record<
			string,
			unknown
		>;
		assert.equal(raw.modelKey, "test-provider/test-model");
		assert.equal(raw.effort, "low");
		assert.equal(loadAdvisorConfig().modelKey, "test-provider/test-model");
		assert.equal(loadAdvisorConfig().effort, "low");
	});
});

test("missing config file loads as empty", () => {
	withTempConfigHome(() => {
		assert.deepEqual(loadAdvisorConfig(), {});
	});
});

test("clearing selection writes empty config", () => {
	withTempConfigHome((dir) => {
		assert.equal(saveAdvisorConfig(undefined, undefined), true);
		const raw = JSON.parse(readFileSync(join(dir, "pi-advisor", "config.json"), "utf-8")) as Record<
			string,
			unknown
		>;
		assert.deepEqual(raw, {});
	});
});

test("resolveAdvisorModel falls back to session model when nothing is selected", () => {
	resetAdvisorSelectionForTests();
	setAdvisorSelection(undefined, undefined);
	const sessionModel = { provider: "p", id: "s", name: "session" };
	const ctx = {
		model: sessionModel,
		thinkingLevel: "low",
		modelRegistry: { getAvailable: () => [] },
	} as never;
	const resolved = resolveAdvisorModel(ctx);
	assert.ok(resolved);
	assert.equal((resolved.model as unknown as { id: string }).id, "s");
	resetAdvisorSelectionForTests();
});

test("resolveAdvisorModel returns null with no session model and no selection", () => {
	resetAdvisorSelectionForTests();
	setAdvisorSelection(undefined, undefined);
	const ctx = {
		model: undefined,
		thinkingLevel: undefined,
		modelRegistry: { getAvailable: () => [] },
	} as never;
	assert.equal(resolveAdvisorModel(ctx), null);
	resetAdvisorSelectionForTests();
});

test("resolveAdvisorModel finds saved model in registry and reuses cache", () => {
	resetAdvisorSelectionForTests();
	const saved = { provider: "p", id: "m", name: "saved" };
	let scans = 0;
	const ctx = {
		model: undefined,
		thinkingLevel: undefined,
		modelRegistry: {
			getAvailable: () => {
				scans += 1;
				return [saved];
			},
		},
	} as never;
	setAdvisorSelection("p/m", "low");
	const first = resolveAdvisorModel(ctx);
	const second = resolveAdvisorModel(ctx);
	assert.ok(first);
	assert.equal((first.model as unknown as { id: string }).id, "m");
	assert.equal(first.thinkingLevel, "low");
	assert.equal(second?.model, first.model);
	assert.equal(scans, 1);
	resetAdvisorSelectionForTests();
});

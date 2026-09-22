import type { Api, Model } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SelectItem } from "@earendil-works/pi-tui";
import {
	getAdvisorEffort,
	getAdvisorModelKey,
	modelKey,
	SESSION_MODEL_VALUE,
	saveAdvisorConfig,
	setAdvisorSelection,
} from "../src/advisor-state.ts";
import { showPicker } from "../src/advisor-ui.ts";

const OFF = "__off__";
const CHECK = " ✓";
const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

const MODEL_TITLE = "Advisor";
const MODEL_PROSE = ["Pick the advisor model."];

const EFFORT_TITLE = "Reasoning Level";
const EFFORT_PROSE = ["Pick reasoning effort. Higher is more thorough."];

function modelItems(available: Model<Api>[], current: string | undefined): SelectItem[] {
	const items = available.map((m) => {
		const k = modelKey(m);
		return {
			value: k,
			label: `${m.name}  (${m.provider})${k === current ? CHECK : ""}`,
		};
	});
	items.unshift({
		value: SESSION_MODEL_VALUE,
		label: `Use session model${current === SESSION_MODEL_VALUE || !current ? CHECK : ""}`,
	});
	return items;
}

function effortItems(picked: Model<Api>): SelectItem[] {
	const levels = getSupportedThinkingLevels(picked).filter((l): l is (typeof EFFORTS)[number] =>
		(EFFORTS as readonly string[]).includes(l),
	);
	return [
		{ value: OFF, label: "off (no reasoning sent)" },
		...levels.map((l) => ({
			value: l,
			label: l === "low" ? `${l} (recommended)` : l,
		})),
	];
}

export default function registerAdvisorCommand(pi: ExtensionAPI): void {
	pi.registerCommand("advisor", {
		description: "Configure the advisor model — pick model and reasoning level",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/advisor requires interactive mode", "error");
				return;
			}

			const available = ctx.modelRegistry.getAvailable();
			const currentKey = getAdvisorModelKey() ?? SESSION_MODEL_VALUE;

			const choice = await showPicker(ctx, {
				title: MODEL_TITLE,
				prose: MODEL_PROSE,
				items: modelItems(available, currentKey),
			});
			if (!choice) return;

			if (choice === SESSION_MODEL_VALUE) {
				if (!saveAdvisorConfig(undefined, undefined)) {
					ctx.ui.notify("Failed to save advisor selection", "error");
					return;
				}
				setAdvisorSelection(undefined, undefined);
				ctx.ui.notify("Advisor: using session model", "info");
				return;
			}

			const picked = available.find((m) => modelKey(m) === choice);
			if (!picked) {
				ctx.ui.notify(`Advisor selection not found: ${choice}`, "error");
				return;
			}

			let effort: (typeof EFFORTS)[number] | undefined;
			if (picked.reasoning) {
				const cur = getAdvisorEffort() as (typeof EFFORTS)[number] | undefined;
				const res = await showPicker(ctx, {
					title: EFFORT_TITLE,
					prose: EFFORT_PROSE,
					items: effortItems(picked),
					preferredValue: cur ?? "low",
				});
				if (!res) ctx.ui.notify("Effort not set — using model default", "info");
				else effort = res === OFF ? undefined : (res as (typeof EFFORTS)[number]);
			}

			if (!saveAdvisorConfig(choice, effort as never)) {
				ctx.ui.notify("Failed to save advisor selection", "error");
				return;
			}
			setAdvisorSelection(choice, effort as never);
			ctx.ui.notify(`Advisor: ${choice}${effort ? ` @ ${effort}` : ""}`, "info");
		},
	});
}

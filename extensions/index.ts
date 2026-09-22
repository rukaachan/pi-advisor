import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerAdvisorCommand from "./advisor-command.ts";
import registerAdvisorTool from "./advisor-tool.ts";

export default function (pi: ExtensionAPI) {
	registerAdvisorTool(pi);
	registerAdvisorCommand(pi);
}

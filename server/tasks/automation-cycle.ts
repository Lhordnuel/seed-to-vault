import { defineTask } from "nitro/task";
import { runScoutAutomationCycle } from "../../src/lib/automation.server";

export default defineTask({
  meta: {
    name: "automation-cycle",
    description: "Run one bounded scouting, reply, and follow-up drafting cycle.",
  },
  async run() {
    const result = await runScoutAutomationCycle();
    console.info("[automation] scheduled cycle", result);
    return { result };
  },
});

import { describe, expect, test } from "bun:test";
import {
  buildTourSteps,
  HUD_EDIT_TARGET,
  RAID_SELECTOR_TARGET,
  REPLAY_TARGET,
} from "../ui/guidedTourModel";

describe("guided tour steps", () => {
  test("a host inside the simulator gets the overview and all three spotlights", () => {
    const steps = buildTourSteps({ inSimulator: true, isHost: true, hasReplayButton: true });
    expect(steps.map(step => step.id)).toEqual(["overview", "hudLayout", "raidSelector", "replays"]);
    expect(steps.map(step => step.target)).toEqual([null, HUD_EDIT_TARGET, RAID_SELECTOR_TARGET, REPLAY_TARGET]);
  });

  test("a non-host keeps the HUD and raid steps with host-only wording and skips replays", () => {
    const steps = buildTourSteps({ inSimulator: true, isHost: false, hasReplayButton: false });
    expect(steps.map(step => step.id)).toEqual(["overview", "hudLayout", "raidSelector"]);
    expect(steps[2].body).toContain("Only the session host");
  });

  test("outside the simulator only the overview is shown, telling the user to enter it", () => {
    const steps = buildTourSteps({ inSimulator: false, isHost: false, hasReplayButton: false });
    expect(steps).toHaveLength(1);
    expect(steps[0].id).toBe("overview");
    expect(steps[0].footnote).toContain("Enter the simulator");
  });

  test("the in-simulator overview points back at Getting Started", () => {
    const [overview] = buildTourSteps({ inSimulator: true, isHost: true, hasReplayButton: true });
    expect(overview.footnote).toBe("Revisit this tour anytime via ? → Getting Started.");
    expect(overview.sections?.map(section => section.title)).toContain("REPLAYS");
  });
});

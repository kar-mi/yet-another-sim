// Step content for the first-time guided tour. Pure data so the sequencing rules (host-only
// wording, skipped replay spotlight, deferred start outside the simulator) are testable.

type TourStepId = "overview" | "hudLayout" | "raidSelector" | "replays";

interface TourSection {
  title: string;
  body: string;
}

export interface TourStep {
  id: TourStepId;
  title: string;
  /** CSS selector of the control to spotlight; null on the overview card. */
  target: string | null;
  body?: string;
  sections?: TourSection[];
  footnote?: string;
}

export interface TourContext {
  /** False while the welcome card is opened from outside a live simulator session. */
  inSimulator: boolean;
  isHost: boolean;
  /** The ▶ replays toolbar button only exists for the current session host. */
  hasReplayButton: boolean;
}

export const HUD_EDIT_TARGET = "#hud-edit-btn";
export const RAID_SELECTOR_TARGET = '[data-hud-group="raidselector"]';
export const REPLAY_TARGET = "#replay-btn";

const REVISIT_NOTE = "Revisit this tour anytime via ? → Getting Started.";

const OVERVIEW_SECTIONS: TourSection[] = [
  { title: "SETTINGS", body: "Click the ⚙ icon (top-right) to adjust camera, keybinds, controller, and display settings." },
  { title: "CUSTOMIZE THE UI", body: "In Settings → Display, set the UI scale/font, or click EDIT HUD LAYOUT to drag HUD elements, resize them with their handles, or right-click to hide them. You can also click the grid button." },
  { title: "LOADING A RAID", body: "Once in a session, use the RAID selector at the top of the screen to pick a raid. It loads for everyone at time zero; press START when the group is ready. OPTIONS next to it holds waymarks, bot patterns and RNG pins." },
  { title: "REPLAYS", body: "Every pull is recorded. The host can stop a pull and open ▶ in the top-right toolbar to rewatch this session's recordings." },
];

export function buildTourSteps(ctx: TourContext): TourStep[] {
  const overview: TourStep = {
    id: "overview",
    title: "WELCOME",
    target: null,
    sections: OVERVIEW_SECTIONS,
    footnote: ctx.inSimulator
      ? REVISIT_NOTE
      : `Enter the simulator to see the controls — NEXT starts the tour there. ${REVISIT_NOTE}`,
  };
  if (!ctx.inSimulator) return [overview];

  const steps: TourStep[] = [
    overview,
    {
      id: "hudLayout",
      title: "HUD LAYOUT",
      target: HUD_EDIT_TARGET,
      body: "Click ▦ to edit the HUD. Drag an element to move it, drag the handles on the selected element to resize it, right-click it to hide or show it, then SAVE & CLOSE.",
    },
    {
      id: "raidSelector",
      title: "PLAYBACK",
      target: RAID_SELECTOR_TARGET,
      body: ctx.isHost
        ? "Browse or search raids here. The one you pick loads for everyone, ready to START, and OPTIONS beside it holds waymarks, bot patterns and RNG pins."
        : "Raids are listed here. Only the session host can pick one, and their choice loads the raid for everyone.",
    },
  ];
  if (ctx.hasReplayButton) {
    steps.push({
      id: "replays",
      title: "REPLAYS",
      target: REPLAY_TARGET,
      body: "STOP the pull to save it, then click ▶ to browse and rewatch this session's recordings.",
    });
  }
  return steps;
}

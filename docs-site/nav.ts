export interface NavPage {
  source: string;
  url: string;
  title: string;
  description: string;
}

export interface NavSection {
  id: string;
  title: string;
  pages: NavPage[];
}

export const NAV: NavSection[] = [
  {
    id: "start",
    title: "Start here",
    pages: [
      {
        source: "docs/index.md",
        url: "/",
        title: "Yet Another Sim",
        description: "Documentation for Yet Another Sim, a browser raid-mechanics practice sandbox for FFXIV-style encounters.",
      },
      {
        source: "docs/getting-started.md",
        url: "/getting-started/",
        title: "Getting started",
        description: "Create or join a session, claim a party slot, pick a raid, practise against bots, and stop or restart a pull.",
      },
      {
        source: "docs/simulator-guide.md",
        url: "/simulator-guide/",
        title: "Simulator guide",
        description: "Movement and camera, keybinds, controllers, the HUD, display options, host permissions, and replay review.",
      },
    ],
  },
  {
    id: "authoring",
    title: "Authoring",
    pages: [
      {
        source: "docs/authoring/index.md",
        url: "/authoring/",
        title: "Authoring overview",
        description: "How a raid is built out of a YAML timeline and a bot-pattern file, and where to start.",
      },
      {
        source: "docs/authoring-raids.md",
        url: "/authoring/raids/",
        title: "Authoring raids",
        description: "Complete reference for the raid YAML format: arenas, rosters, every event type, effects and optionals.",
      },
      {
        source: "docs/authoring-bot-patterns.md",
        url: "/authoring/bot-patterns/",
        title: "Authoring bot patterns",
        description: "Waypoint patterns, the generic solver, solver holds and rotated frames for bot-controlled party members.",
      },
      {
        source: "docs/authoring/examples.md",
        url: "/authoring/examples/",
        title: "Worked examples",
        description: "The authoring demo end to end, then annotated excerpts from the real Dancing Mad encounters and their bot files.",
      },
      {
        source: "docs/movement-and-scale.md",
        url: "/authoring/movement-and-scale/",
        title: "Movement & scale",
        description: "How the simulator's distances and movement speed map onto FFXIV yalms.",
      },
      {
        source: "docs/authoring/debuff-lookup.md",
        url: "/authoring/debuff-lookup/",
        title: "Looking up debuff icons",
        description: "How to find a status name and download its icon from XIVAPI when registering a new debuff.",
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    pages: [
      {
        source: "docs/troubleshooting/index.md",
        url: "/troubleshooting/",
        title: "Troubleshooting overview",
        description: "Sessions, party slots, host controls, replays and stored settings — where to look when something is not working.",
      },
      {
        source: "docs/troubleshooting/browsers.md",
        url: "/troubleshooting/browsers/",
        title: "Browser & performance help",
        description: "Diagnostic steps for lag, rollbacks and missing visuals, plus what to include in a bug report.",
      },
    ],
  },
  {
    id: "developer",
    title: "Developer reference",
    pages: [
      {
        source: "docs/workflow.md",
        url: "/developer/workflow/",
        title: "Development workflow",
        description: "Local setup, the day-to-day loop, project layout, testing, building and deployment.",
      },
      {
        source: "docs/effects-package.md",
        url: "/developer/effects-package/",
        title: "The effects package",
        description: "What src/effects owns, its import boundary, which renderer layers share each visual primitive, and how effect resources are disposed.",
      },
      {
        source: "docs/arena-package.md",
        url: "/developer/arena-package/",
        title: "The arena package",
        description: "Arena types, schemas, generators, packaged floor images, floor membership, Babylon mesh creation, and import boundaries.",
      },
      {
        source: "docs/status-package.md",
        url: "/developer/status-package/",
        title: "The status package",
        description: "The buff and debuff catalog, reference and override rules, the behavior registry, engine services and the import boundary of src/status.",
      },
      {
        source: "docs/deterministic-lockstep.md",
        url: "/developer/deterministic-lockstep/",
        title: "Deterministic lockstep",
        description: "The simulation model that keeps every client's world identical, and the rules engine changes must follow.",
      },
      {
        source: "docs/session-lifecycle.md",
        url: "/developer/session-lifecycle/",
        title: "Session lifecycle",
        description: "Participant identity across a refresh, the setup/workshop/raid phases, slot reservations versus the frozen pull roster, and when a raid shuts down.",
      },
      {
        source: "docs/invariants.md",
        url: "/developer/invariants/",
        title: "Code invariants & workarounds",
        description: "Non-obvious rules the code relies on and the reasons behind its workarounds, collected here because the source carries no comments.",
      },
    ],
  },
];

export const UNPUBLISHED: string[] = [
  "docs/finding_debuffs.md",
];

export const PAGES: NavPage[] = NAV.flatMap(section => section.pages);

export function sectionOf(page: NavPage): NavSection {
  const section = NAV.find(candidate => candidate.pages.includes(page));
  if (!section) throw new Error(`Page ${page.url} is not in any nav section`);
  return section;
}

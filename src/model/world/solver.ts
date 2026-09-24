import type { Vec2 } from "@shared/math";
import type { CrystalElement, Role } from "./foundation";

export type GenericSolverRule = {
  when: {
    static?: true;
    mechanic?: string | string[];
    selectedEvent?: string | string[];
    role?: Role | Role[];
    debuff?: string | string[];
    partyDebuff?: string | string[];
    partnerDebuff?: string | string[];
    soaks?: boolean;
    plant?: string;
    plantSlot?: number;
    endingFacing?: { event: string; offset: number };
  };
  startAt?: number;
  endAt?: number;
  frame?: "matched" | FrameRef[];
  origin?: { boss: string };
  mirrorLateral?: boolean;
  mirrorForward?: boolean;
  spots?: Record<string, Vec2>;
  spot?: Vec2;
  safeSpots?: Vec2[];
  dangerHorizon?: number;
  limitCutSpread?: { spots: Vec2[] };
  freeze?: true;
  nearestEdge?: { from: FrameRef; avoid: FrameRef; clearance: number };
  tetherMidpoint?: { hazardId: string; order: 0 | 1 | 2 };
};

export type FrameRef =
  | string
  | { crystal: CrystalElement }
  | { boss: { id?: string; from: "facing" | "position" } }
  | { blackHoleTether: { hazardId: string; order: 0 | 1 | 2 } }
  | { blackHoleOrb: { hazardId: string; index: 0 | 1 | 2 } };

type SolverHold = {
  mechanic: string | string[];
  duration: number;
};

export type BotSolvers = {
  generic?: GenericSolverRule[];
  holds?: SolverHold[];
};

import type { Waymark } from "./types";

export type WaymarkPreset = { id: string; name: string; marks: Waymark[] };

// Extracted from the waymark layouts already authored across raids/**/*.yaml.
export const WAYMARK_PRESETS: WaymarkPreset[] = [
  {
    id: "standard-12",
    name: "Standard",
    marks: [
      { mark: "A", pos: { x: 0, z: 12 } },
      { mark: "B", pos: { x: 12, z: 0 } },
      { mark: "C", pos: { x: 0, z: -12 } },
      { mark: "D", pos: { x: -12, z: 0 } },
      { mark: "1", pos: { x: 6, z: 6 } },
      { mark: "2", pos: { x: 6, z: -6 } },
      { mark: "3", pos: { x: -6, z: -6 } },
      { mark: "4", pos: { x: -6, z: 6 } },
    ],
  },
  {
    id: "mirrored-12",
    name: "Mirrored",
    marks: [
      { mark: "A", pos: { x: 0, z: 12 } },
      { mark: "B", pos: { x: 12, z: 0 } },
      { mark: "C", pos: { x: 0, z: -12 } },
      { mark: "D", pos: { x: -12, z: 0 } },
      { mark: "1", pos: { x: -6, z: 6 } },
      { mark: "2", pos: { x: 6, z: 6 } },
      { mark: "3", pos: { x: 6, z: -6 } },
      { mark: "4", pos: { x: -6, z: -6 } },
    ],
  },
  {
    id: "standard-16",
    name: "Wide",
    marks: [
      { mark: "A", pos: { x: 0, z: 16 } },
      { mark: "B", pos: { x: 16, z: 0 } },
      { mark: "C", pos: { x: 0, z: -16 } },
      { mark: "D", pos: { x: -16, z: 0 } },
      { mark: "1", pos: { x: 10, z: 10 } },
      { mark: "2", pos: { x: 10, z: -10 } },
      { mark: "3", pos: { x: -10, z: -10 } },
      { mark: "4", pos: { x: -10, z: 10 } },
    ],
  },
];

export function isWaymarkPresetId(id: string): boolean {
  return WAYMARK_PRESETS.some(preset => preset.id === id);
}

// Test-side mirrors of engine constants, derived from the production source so a
// value change (e.g. ROLE_HP) only needs editing in one place and tests follow.
import { ROLE_HP } from "../world";

export const TANK_HP = ROLE_HP.tank;
export const HEALER_HP = ROLE_HP.healer;
export const DPS_HP = ROLE_HP.dps;

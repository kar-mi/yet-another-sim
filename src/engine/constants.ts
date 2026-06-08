// Simulation constants. Physics/movement constants are public (imported by botIntent, world,
// and client HUD); the LINGER constants govern how long a resolved mechanic stays visible so the
// renderer can flash its outcome. sim.ts re-exports the public ones for backward compatibility.

export const MOVE_SPEED = 6;
export const SPRINT_MULTIPLIER = 1.3;
export const JUMP_SPEED = 9;
export const GRAVITY = 24;
export const DEATH_FLOOR_Y = -10; // players die after falling this far below the arena floor
export const SPRINT_DURATION = 10;
export const SPRINT_COOLDOWN = 60;
export const ANTI_KB_DURATION = 5;    // seconds the anti-knockback buff negates knockback
export const ANTI_KB_COOLDOWN = 120;  // seconds before anti-knockback can be used again
export const PROVOKE_COOLDOWN = 30;   // seconds before a tank can provoke again
export const PROVOKE_LEAD = 1;        // threat set above the current max so the tank becomes target
export const KNOCKBACK_FRICTION = 40; // ground deceleration (units/s^2); v0 = sqrt(2*FRICTION*distance)

export const INITIAL_TANK_THREAT = 1; // seed so a tank starts as the boss's target

export const INTERCEPT_THRESHOLD = 2.0;
export const TARGETED_LINGER = 0.7; // seconds a targeted bait's circle stays visible after it resolves
export const TOWER_LINGER = 0.7; // seconds a tower stays visible after it resolves (success/failure flash)
export const CHAIN_LINGER = 0.7; // seconds a chain stays visible after it breaks/bursts (outcome flash)
export const LINE_LINK_LINGER = 0.7; // seconds a line link/statue stays visible after resolving
export const FORCED_MARCH_LINGER = 0.4; // keep a finished forced-march trap briefly so the client can fade it

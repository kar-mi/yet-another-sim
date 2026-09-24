// Compatibility barrel for the serialized simulation model.
// Domain declarations live in shared/world; existing consumers keep importing @shared/types.
export * from "./world/foundation";
export * from "./world/solver";
export * from "./world/effects";
export * from "./world/entities";
export * from "./world/mechanics";
export * from "./world/state";

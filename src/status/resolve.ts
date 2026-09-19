import type { StatusBehavior, StatusOverrides, StatusRef, StatusSpec, StatusTemplate } from "./types";
import { statusTemplate } from "./catalog";

export type ResolveResult = { ok: true; spec: StatusSpec } | { ok: false; error: string };

export function resolveStatus({ ref, ...overrides }: StatusRef): ResolveResult {
  const template = statusTemplate(ref);
  if (!template) return { ok: false, error: `unknown status ref "${ref}"` };
  return overrideTemplate(ref, template, overrides);
}

export function requireStatus(ref: string, overrides: StatusOverrides = {}): StatusSpec {
  return unwrap(resolveStatus({ ref, ...overrides }));
}

export function overrideStatus(spec: StatusSpec, overrides: StatusOverrides): StatusSpec {
  const { ref, ...template } = spec;
  return unwrap(overrideTemplate(ref, template, overrides));
}

function overrideTemplate(ref: string, template: StatusTemplate, overrides: StatusOverrides): ResolveResult {
  if (overrides.kind !== undefined && overrides.kind !== template.kind) {
    return { ok: false, error: `status "${ref}" is a ${template.kind}; its classification cannot be overridden` };
  }
  if (overrides.behavior?.kind !== undefined && overrides.behavior.kind !== template.behavior.kind) {
    return { ok: false, error: `status "${ref}" has behavior "${template.behavior.kind}"; it cannot be overridden to "${overrides.behavior.kind}"` };
  }
  const behavior = overrides.behavior === undefined
    ? template.behavior
    : { ...template.behavior, ...overrides.behavior } as StatusBehavior;
  return { ok: true, spec: { ...template, ...overrides, kind: template.kind, behavior, ref } };
}

function unwrap(result: ResolveResult): StatusSpec {
  if (!result.ok) throw new Error(result.error);
  return result.spec;
}

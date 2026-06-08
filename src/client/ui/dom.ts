// Shared DOM construction helpers for the client UI modules.

type ElProps<K extends keyof HTMLElementTagNameMap> = Partial<HTMLElementTagNameMap[K]> & {
  /** Attributes set via setAttribute (e.g. ARIA, role). */
  attrs?: Record<string, string>;
};

/**
 * Create an element, assigning the given properties and appending children.
 * Undefined property values are skipped so optional fields don't clobber defaults.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElProps<K>,
  children?: (Node | string)[],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    const { attrs, ...rest } = props;
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) (node as Record<string, unknown>)[key] = value;
    }
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    }
  }
  if (children) node.append(...children);
  return node;
}

/** Positional shorthand for the common className/textContent case. */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  return el(tag, { className, textContent } as ElProps<K>);
}

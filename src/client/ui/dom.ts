type ElProps<K extends keyof HTMLElementTagNameMap> = Partial<HTMLElementTagNameMap[K]> & {
  attrs?: Record<string, string>;
};

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

export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  return el(tag, { className, textContent } as ElProps<K>);
}

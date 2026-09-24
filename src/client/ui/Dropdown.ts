import { el } from "./dom";

export type DropdownOption = { value: string; label: string };

export type Dropdown = {
  element: HTMLElement;
  setValue: (value: string) => void;
  close: () => void;
};

export function createDropdown(config: {
  ariaLabel: string;
  placeholder: string;
  options: DropdownOption[];
  onSelect: (value: string) => void;
  className?: string;
}): Dropdown {
  let value = "";
  let open = false;

  const labelEl = el("span", { className: "yas-dropdown-label", textContent: config.placeholder });
  const trigger = el("button", {
    type: "button",
    className: "yas-dropdown-trigger",
    attrs: { "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": config.ariaLabel },
  }, [labelEl, el("span", { className: "yas-dropdown-glyph", textContent: "▾", attrs: { "aria-hidden": "true" } })]);

  const menu = el("div", { className: "yas-dropdown-menu", hidden: true, attrs: { role: "listbox" } });
  const optionEls = config.options.map(option => {
    const button = el("button", {
      type: "button",
      className: "yas-dropdown-option",
      textContent: option.label,
      attrs: { role: "option", "aria-selected": "false" },
    });
    button.addEventListener("click", () => {
      setValue(option.value);
      setOpen(false);
      trigger.focus();
      config.onSelect(option.value);
    });
    menu.appendChild(button);
    return button;
  });

  const element = el("div", {
    className: config.className ? `yas-dropdown ${config.className}` : "yas-dropdown",
  }, [trigger, menu]);

  const onPointerDown = (event: PointerEvent) => {
    if (!element.contains(event.target as Node)) setOpen(false);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setOpen(false);
      trigger.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const focused = optionEls.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = focused === -1 ? (step === 1 ? 0 : optionEls.length - 1) : focused + step;
    optionEls[Math.max(0, Math.min(optionEls.length - 1, next))]?.focus();
  };

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    menu.hidden = !next;
    element.classList.toggle("is-open", next);
    trigger.setAttribute("aria-expanded", String(next));
    if (next) {
      document.addEventListener("pointerdown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
    } else {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    }
  }

  function setValue(next: string): void {
    value = next;
    const selected = config.options.find(option => option.value === next);
    labelEl.textContent = selected?.label ?? config.placeholder;
    for (const [index, button] of optionEls.entries()) {
      const isActive = config.options[index]!.value === value;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    }
  }

  trigger.addEventListener("click", () => {
    setOpen(!open);
    if (open) optionEls[0]?.focus();
  });
  setValue("");

  return {
    element,
    setValue,
    close: () => setOpen(false),
  };
}

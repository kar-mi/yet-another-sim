# Looking up debuff icons

Every debuff an encounter applies must be registered in `DEBUFF_REGISTRY`
(`src/engine/status/debuffs.ts`) and referenced from YAML with `ref:`. Registering one needs two
things you do not have yet: the status's exact in-game name, and its icon.

Both come from [XIVAPI](https://v2.xivapi.com). This page is the short version of how to get them.

> **Run these requests yourself.** Do not delegate this lookup to an AI assistant — it is exactly
> the kind of task where a plausible-looking wrong icon id costs more time than doing it by hand.

## 1. Find the status

Search the `Status` sheet by name:

```sh
curl --request GET \
  --url 'https://v2.xivapi.com/api/search?query=Name~"Tailwind"&sheets=Status'
```

The `~` is a contains match, so partial names work. The response gives you each match's row id, its
exact `Name`, and its `Icon`.

Two things to check before moving on:

- **The exact name**, including capitalisation and punctuation. Several statuses differ only by an
  apostrophe or a numeral, and the name is what the HUD shows.
- **The right row.** Duty-specific statuses frequently share a name with a job buff.

If you want to know what other sheets exist, list them:

```sh
curl --request GET --url https://v2.xivapi.com/api/sheet
```

Statuses live in the `Status` sheet; that is the only one this workflow needs.

## 2. Download the icon

The search result's `Icon` field gives you the icon path. Request it as a PNG:

```sh
https://v2.xivapi.com/api/asset/ui/icon/215000/215905_hr1.tex?format=png
```

The two numbers are the icon's folder and its id — `215905` lives in the `215000` folder. The
`_hr1` suffix is the high-resolution variant, which is what you want.

Save it into `static/debuffs/` using a lower-case, underscore-separated filename that matches the
status:

```text
static/debuffs/tailwind.png
```

That directory is served directly, and the registry entry refers to files by name only.

## 3. Register the debuff

Add an entry to `DEBUFF_REGISTRY` keyed by a snake-case id:

```ts
tailwind: {
  name: "Tailwind",
  kind: "debuff",
  duration: 9,
  icon: "tailwind.png",
  behavior: { kind: "none" },
},
```

- `name` is what the HUD shows and what mechanics match on when they refer to carriers by name.
- `icon` is the filename under `static/debuffs/`. Leaving it out falls back to a generic glyph
  chosen from the behavior.
- `behavior` is what the debuff actually does. `{ kind: "none" }` is a marker with no effect, which
  is common — plenty of debuffs exist only so that another event can find their carriers.

The full list of behaviors and the other per-entry fields is in
[Effects](../authoring-raids.md#effects).

## 4. Use it

From the encounter YAML, reference the registry key:

```yaml
applyEffect:
  ref: tailwind
```

Any other field alongside `ref` overrides the registry entry for that one usage — a different
`duration` for this cast, say — without changing the shared definition.

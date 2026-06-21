import { describe, expect, test } from "bun:test";
import { createRaidCatalogAccessor } from "./raidCatalog";

describe("createRaidCatalogAccessor", () => {
  test("coalesces concurrent loads", async () => {
    let resolveLoad!: (value: string[]) => void;
    let calls = 0;
    const load = () => {
      calls++;
      return new Promise<string[]>(resolve => { resolveLoad = resolve; });
    };
    const get = createRaidCatalogAccessor(load, 60_000);

    const first = get();
    const second = get();
    expect(calls).toBe(1);
    resolveLoad(["raid"]);
    expect(await first).toEqual(["raid"]);
    expect(await second).toEqual(["raid"]);
  });

  test("reuses data within the TTL and reloads once after expiry", async () => {
    let now = 1_000;
    let calls = 0;
    const load = async () => ({ generation: ++calls });
    const get = createRaidCatalogAccessor(load, 100, () => now);

    const first = await get();
    now = 1_099;
    expect(await get()).toBe(first);
    expect(calls).toBe(1);

    now = 1_100;
    const [second, coalesced] = await Promise.all([get(), get()]);
    expect(second).toBe(coalesced);
    expect(second.generation).toBe(2);
    expect(calls).toBe(2);
  });

  test("does not cache failed loads", async () => {
    let calls = 0;
    const get = createRaidCatalogAccessor(async () => {
      if (++calls === 1) throw new Error("scan failed");
      return "ok";
    }, 100);

    await expect(get()).rejects.toThrow("scan failed");
    expect(await get()).toBe("ok");
    expect(calls).toBe(2);
  });
});

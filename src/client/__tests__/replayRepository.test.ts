import { expect, test } from "bun:test";
import { ReplayRepository, ReplayRepositoryError } from "../replayRepository";
import { REPLAY_FORMAT_VERSION } from "@shared/replay";
import { createWorld } from "../../engine/world";
import { createEmptyRaid } from "../../server/sessionRaid";

const summary = { pull: 1, raidId: "empty", ticks: 2, supported: true, formatVersion: REPLAY_FORMAT_VERSION };
const replay = { formatVersion: REPLAY_FORMAT_VERSION, raidId: "empty", world: createWorld(createEmptyRaid(), 1), frames: [] };

test("ReplayRepository validates and caches replay responses", async () => {
  let requests = 0;
  const repository = new ReplayRepository(async (input) => {
    requests++;
    const url = String(input);
    return Response.json(url.endsWith("/1") ? replay : [summary]);
  });

  expect(await repository.list("session")).toEqual([summary]);
  expect(await repository.load("session", 1)).toEqual(replay);
  expect(await repository.load("session", 1)).toEqual(replay);
  expect(requests).toBe(2);
});

test("ReplayRepository preserves unsupported-format errors", async () => {
  const repository = new ReplayRepository(async () => Response.json({
    error: "unsupported_format",
    message: "Replay format is not supported",
    expectedVersion: 1,
    receivedVersion: null,
  }, { status: 409 }));

  await expect(repository.load("session", 1)).rejects.toBeInstanceOf(ReplayRepositoryError);
  await expect(repository.load("session", 1)).rejects.toMatchObject({ code: "unsupported_format" });
});

test("ReplayRepository rejects malformed successful payloads", async () => {
  const repository = new ReplayRepository(async () => Response.json([{ pull: "one" }]));
  await expect(repository.list("session")).rejects.toMatchObject({ code: "corrupt_data" });
});

test("ReplayRepository invokes browser fetch without a repository receiver", async () => {
  const request = function (this: unknown): Promise<Response> {
    if (this !== undefined) throw new TypeError("Illegal invocation");
    return Promise.resolve(Response.json([summary]));
  };
  const repository = new ReplayRepository(request);
  expect(await repository.list("session")).toEqual([summary]);
});

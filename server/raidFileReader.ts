export async function parseRaidFile(filePath: string): Promise<unknown> {
  const f = Bun.file(filePath);
  if (filePath.endsWith(".json")) return f.json();
  return Bun.YAML.parse(await f.text());
}

export async function readRaidObject(basePath: string): Promise<unknown> {
  for (const ext of [".yaml", ".yml", ".json"]) {
    const f = Bun.file(basePath + ext);
    if (await f.exists()) return parseRaidFile(basePath + ext);
  }
  throw new Error(`No raid file found at ${basePath} (.yaml/.yml/.json)`);
}

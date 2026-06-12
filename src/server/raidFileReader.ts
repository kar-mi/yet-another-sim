export async function parseRaidFile(filePath: string): Promise<unknown> {
  const f = Bun.file(filePath);
  return Bun.YAML.parse(await f.text());
}

export async function readRaidObject(basePath: string): Promise<unknown> {
  for (const ext of [".yaml", ".yml"]) {
    const f = Bun.file(basePath + ext);
    if (await f.exists()) return parseRaidFile(basePath + ext);
  }
  throw new Error(`No raid file found at ${basePath} (.yaml/.yml)`);
}

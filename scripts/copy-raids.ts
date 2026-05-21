import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const outDir = "dist";
const target = join(outDir, "raids");

mkdirSync(outDir, { recursive: true });
rmSync(target, { recursive: true, force: true });
cpSync("raids", target, { recursive: true });

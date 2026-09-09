export const SITE = {
  title: "Yet Another Sim Documentation",
  shortTitle: "Yet Another Sim",
  origin: "https://docs.yetanothersim.com",
  base: "/",
  simulatorUrl: "https://yetanothersim.com",
  repoUrl: "https://github.com/kar-mi/yet-another-sim",
  branch: "main",
  outDir: "dist/docs",
  devPort: 3001,
} as const;

export function repoFileUrl(repoPath: string): string {
  return `${SITE.repoUrl}/blob/${SITE.branch}/${repoPath}`;
}

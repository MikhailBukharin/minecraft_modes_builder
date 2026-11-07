// Run the independent JavaScript checks without a shell or extra dependencies.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL(".", import.meta.url));
for (const file of readdirSync(cwd)
  .filter((name) => /^test_.*\.mjs$/.test(name))
  .sort()) {
  const result = spawnSync(process.execPath, [file], { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

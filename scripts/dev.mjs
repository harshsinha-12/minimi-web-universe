import { spawn } from "node:child_process";
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
const children = [
  spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", ...process.argv.slice(2)],
    { stdio: "inherit", env: process.env },
  ),
  spawn(
    process.execPath,
    ["--watch", "--import", "tsx", "src/memory/worker.ts"],
    { stdio: "inherit", env: process.env },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 700).unref();
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
for (const child of children)
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });

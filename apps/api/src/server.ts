import fs from "node:fs";
import { createApp } from "./app.js";
import { env, aiEnabled } from "./env.js";
import { startJobWorker } from "./modules/jobs/worker.js";
import { sqliteReady } from "./prisma.js";

fs.mkdirSync(env.storageRoot, { recursive: true });

const app = createApp();

await sqliteReady;

app.listen(env.port, () => {
  console.log(`FileHub API listening on http://localhost:${env.port}`);
  console.log(`AI agent: ${aiEnabled ? "enabled" : "disabled (no ANTHROPIC_API_KEY — degradation mode)"}`);
  if (env.allowedCidrs.length > 0) {
    console.log(`Network allowlist active: ${env.allowedCidrs.join(", ")}`);
  } else {
    console.log("Network allowlist: disabled (open access — set ALLOWED_CIDRS for production)");
  }
});

startJobWorker();

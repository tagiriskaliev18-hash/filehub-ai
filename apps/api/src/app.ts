import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";
import { cidrAllowlist } from "./middleware/cidrAllowlist.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { filesRouter } from "./modules/files/files.routes.js";
import { jobsRouter } from "./modules/jobs/jobs.routes.js";
import { compressionRouter } from "./modules/compression/compression.routes.js";
import { conversionRouter } from "./modules/conversion/conversion.routes.js";
import { agentRouter } from "./modules/agent/agent.routes.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { shareRouter } from "./modules/files/share.routes.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);

  // Reflect whatever origin the request came from rather than maintaining a
  // fixed allowlist: on a LAN dev deployment the reachable address (IP vs.
  // hostname, and which one) shifts whenever the machine's network identity
  // changes, and every such change previously required updating WEB_ORIGIN
  // and restarting the server just to stop CORS from silently breaking
  // login. The actual access boundary here is the network layer (see
  // cidrAllowlist below / ALLOWED_CIDRS), not the CORS origin check, so this
  // trades a redundant check for one less way logins mysteriously fail.
  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));
  app.use(cidrAllowlist);

  app.use(healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/files", filesRouter);
  app.use("/api/jobs", jobsRouter);
  app.use("/api/compress", compressionRouter);
  app.use("/api/convert", conversionRouter);
  app.use("/api/agent", agentRouter);
  app.use("/api/admin", adminRouter);
  app.use("/s", shareRouter);

  // Serves the built web/dist bundle when it's present next to the compiled
  // api (the container image layout) so the whole app runs as one process
  // on one port — same-origin, so apps/web's default API_URL guess just
  // works without a VITE_API_URL build arg. Absent in plain local dev,
  // where the two apps run as separate Vite/tsx processes instead.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const webDistPath = path.resolve(__dirname, "../../web/dist");
  if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    app.get(/^(?!\/(api|s|health)).*/, (_req, res) => {
      res.sendFile(path.join(webDistPath, "index.html"));
    });
  }

  app.use(errorHandler);

  return app;
}

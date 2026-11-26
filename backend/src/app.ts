import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { buildRouter } from "./routes/index.js";
import { errorHandler, limiters, notFound } from "./middleware/index.js";
import type { AppDeps } from "./controllers/index.js";

export function createApp(deps: AppDeps, opts: { corsOrigin: string; logRequests?: boolean }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: opts.corsOrigin.split(",").map((s) => s.trim()),
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );
  app.use(express.json({ limit: "200kb" }));
  if (opts.logRequests) app.use(morgan("dev"));

  app.use("/api", limiters.api, buildRouter(deps));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

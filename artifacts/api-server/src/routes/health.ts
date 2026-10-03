import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

// Injected by build.mjs; undefined when running from source (tsx / dev).
declare const __BUILD_SHA__: string | undefined;
declare const __BUILT_AT__: string | undefined;

const build = {
  sha: typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : process.env.BUILD_SHA ?? "unknown",
  builtAt: typeof __BUILT_AT__ === "string" ? __BUILT_AT__ : null,
};

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json({ ...data, build });
});

export default router;

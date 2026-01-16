import { Router } from "express";
import { getCredentials } from "../stripeclient";

const router = Router();

router.get("/config", async (_req, res) => {
  try {
    const { publishableKey } = await getCredentials();
    res.json({ publishableKey });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Stripe config failed" });
  }
});

export default router;

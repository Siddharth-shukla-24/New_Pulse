import { Router } from "express";
import { HttpError, UUID_RE, asyncHandler } from "../http.js";
import { getJob, serializeJob, triggerIngest } from "../jobs.js";

const router = Router();

router.post(
  "/trigger",
  asyncHandler(async (_req, res) => {
    const { job, alreadyRunning } = await triggerIngest();
    res.status(202).json({ ...serializeJob(job), alreadyRunning });
  })
);

router.get(
  "/status/:jobId",
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    if (!UUID_RE.test(jobId)) throw new HttpError(400, "jobId must be a valid UUID");
    const job = await getJob(jobId);
    if (!job) throw new HttpError(404, `Job ${jobId} not found`);
    res.json(serializeJob(job));
  })
);

export default router;
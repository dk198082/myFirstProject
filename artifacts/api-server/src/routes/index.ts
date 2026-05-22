import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import technicianRouter from "./technicians.js";
import workOrderRouter from "./workOrders.js";
import dashboardRouter from "./dashboard.js";
import scheduledJobsRouter from "./scheduledJobs.js";
import jobsByRegionRouter from "./jobsByRegion.js";
import scheduleBoardRouter from "./scheduleBoard.js";
import unscheduledJobsRouter from "./unscheduledJobs.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(technicianRouter);
router.use(workOrderRouter);
router.use(dashboardRouter);
router.use(scheduledJobsRouter);
router.use(jobsByRegionRouter);
router.use(scheduleBoardRouter);
router.use(unscheduledJobsRouter);

export default router;

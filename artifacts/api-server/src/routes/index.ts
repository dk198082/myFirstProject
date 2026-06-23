import { Router, type IRouter } from "express";
import authRouter from "./auth.js";
import healthRouter from "./health.js";
import technicianRouter from "./technicians.js";
import workOrderRouter from "./workOrders.js";
import dashboardRouter from "./dashboard.js";
import scheduledJobsRouter from "./scheduledJobs.js";
import jobsByRegionRouter from "./jobsByRegion.js";
import scheduleBoardRouter from "./scheduleBoard.js";
import unscheduledJobsRouter from "./unscheduledJobs.js";
import resourceUtilizationRouter from "./resourceUtilization.js";
import writebackRouter from "./writeback.js";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(technicianRouter);
router.use(workOrderRouter);
router.use(dashboardRouter);
router.use(scheduledJobsRouter);
router.use(jobsByRegionRouter);
router.use(scheduleBoardRouter);
router.use(unscheduledJobsRouter);
router.use(resourceUtilizationRouter);
router.use(writebackRouter);

export default router;

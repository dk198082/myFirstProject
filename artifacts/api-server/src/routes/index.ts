import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import technicianRouter from "./technicians.js";
import workOrderRouter from "./workOrders.js";
import dashboardRouter from "./dashboard.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(technicianRouter);
router.use(workOrderRouter);
router.use(dashboardRouter);

export default router;

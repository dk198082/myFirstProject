import {
  pgTable,
  serial,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const placeholderJobsTable = pgTable(
  "placeholder_jobs",
  {
    id: serial("id").primaryKey(),
    technicianId: text("technician_id").notNull(),
    title: text("title").notNull(),
    customerName: text("customer_name"),
    city: text("city"),
    state: text("state"),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    notes: text("notes"),
    serviceLocationId: text("service_location_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_placeholder_jobs_tech_time").on(
      table.technicianId,
      table.startTime,
    ),
  ],
);

export const insertPlaceholderJobSchema = createInsertSchema(
  placeholderJobsTable,
).omit({ id: true, createdAt: true });
export type InsertPlaceholderJob = z.infer<typeof insertPlaceholderJobSchema>;
export type PlaceholderJob = typeof placeholderJobsTable.$inferSelect;

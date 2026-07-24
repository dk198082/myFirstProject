import {
  pgTable,
  serial,
  text,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scheduleBlocksTable = pgTable(
  "schedule_blocks",
  {
    id: serial("id").primaryKey(),
    technicianId: text("technician_id").notNull(),
    blockType: text("block_type").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    title: text("title"),
  },
  (table) => [
    index("idx_schedule_blocks_tech_time").on(
      table.technicianId,
      table.startTime,
    ),
    check(
      "schedule_blocks_block_type_check",
      sql`${table.blockType} = ANY (ARRAY['drive_time'::text, 'pto'::text, 'custom'::text])`,
    ),
  ],
);

export const insertScheduleBlockSchema = createInsertSchema(
  scheduleBlocksTable,
).omit({ id: true, createdAt: true });
export type InsertScheduleBlock = z.infer<typeof insertScheduleBlockSchema>;
export type ScheduleBlock = typeof scheduleBlocksTable.$inferSelect;

import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Local overlay for production-group changes written back to D365. The Azure
// PG staging mirror only refreshes periodically, so after a successful D365
// write the new group is stored here and overlaid onto board reads until the
// staging row catches up (at which point the override is deleted).
export const productionGroupOverridesTable = pgTable(
  "production_group_overrides",
  {
    prodid: text("prodid").primaryKey(),
    groupid: text("groupid").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export type ProductionGroupOverride =
  typeof productionGroupOverridesTable.$inferSelect;

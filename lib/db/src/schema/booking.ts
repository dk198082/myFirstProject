import {
  pgTable,
  serial,
  text,
  integer,
  date,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type SlotProgress = {
  pickStart?: boolean;
  pickEnd?: boolean;
  assyStart?: boolean;
  assyEnd?: boolean;
  packStart?: boolean;
  packEnd?: boolean;
};

export const bookingSlotsTable = pgTable("booking_slots", {
  id: serial("id").primaryKey(),
  tab: text("tab").notNull(),
  slotIndex: integer("slot_index").notNull().default(0),
  productionStart: date("production_start", { mode: "string" }),
  pickDays: integer("pick_days").notNull().default(5),
  assyDays: integer("assy_days").notNull().default(15),
  packDays: integer("pack_days").notNull().default(10),
  prodOrder: text("prod_order"),
  salesOrder: text("sales_order"),
  itemid: text("itemid"),
  itemname: text("itemname"),
  customername: text("customername"),
  productionstatus: integer("productionstatus"),
  deliverydate: date("delivery_date", { mode: "string" }),
  pool: text("pool"),
  productionGroup: text("production_group"),
  resources: text("resources"),
  confirmedShipDate: date("confirmed_ship_date", { mode: "string" }),
  inPacking: integer("in_packing"),
  progress: jsonb("progress").$type<SlotProgress>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertBookingSlotSchema = createInsertSchema(bookingSlotsTable).omit(
  {
    id: true,
    createdAt: true,
    updatedAt: true,
  },
);
export type InsertBookingSlot = z.infer<typeof insertBookingSlotSchema>;
export type BookingSlot = typeof bookingSlotsTable.$inferSelect;

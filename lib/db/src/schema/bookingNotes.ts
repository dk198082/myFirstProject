import {
  pgSchema,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const crm = pgSchema("crm");

export const bookingNotesTable = crm.table(
  "booking_notes",
  {
    id: serial("id").primaryKey(),
    bookingId: text("booking_id").notNull().unique(),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("booking_notes_booking_id_key").on(table.bookingId)],
);

export const insertBookingNoteSchema = createInsertSchema(
  bookingNotesTable,
).omit({ id: true });
export type InsertBookingNote = z.infer<typeof insertBookingNoteSchema>;
export type BookingNote = typeof bookingNotesTable.$inferSelect;

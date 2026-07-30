---
name: Booking slot moves are atomic swaps
description: Why moving a booking up/down the calendar uses one server-side swap, not two PATCHes
---

Moving a booking earlier/later in the calendar swaps the *order-allocation
snapshot* between two slots (the slot's dates/durations stay fixed — only the
allocation moves). This must go through the single `POST /booking-slots/swap`
endpoint, which does both updates inside one DB transaction.

**Why:** The original implementation fired two sequential PATCHes from the
client; if the second failed, the move was half-applied and a booking could be
duplicated or lost. Code review rejected that. A transaction guarantees both
rows move together or neither does.

**How to apply:** Any future feature that relocates/reorders allocations across
slots should extend the swap endpoint (or follow the same transaction pattern),
never chain client-side PATCHes. The endpoint also guards same-tab-only
(400 `tab_mismatch`) and missing slots (404).

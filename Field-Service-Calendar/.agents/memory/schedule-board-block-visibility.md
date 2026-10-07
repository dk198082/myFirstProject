---
name: Schedule block visibility on the board
description: Why PTO/Drive Time/Custom blocks can appear "missing" for some technicians/users
---

Schedule blocks (PTO / Drive Time / Custom) are **globally shared**, not per-user:
the `schedule_blocks` table is a plain shared App-DB table (`localPool`) with no
user/session scoping. Any user viewing the board sees the same blocks.

**Gotcha — idle techs are hidden by default.** `ScheduleBoard.tsx` builds `allRegions`
by dropping technicians with zero jobs in the visible range (unless the "Show idle
techs" toggle / `showIdleTechs` is on). A technician who has a block but **no jobs**
that week would vanish along with their block. Fix in place: the visible-tech filter
also keeps any technician whose id is in `techIdsWithBlocks` (built from the fetched
blocks), so blocks always render even for otherwise-idle techs.

**Why:** users reported PTO/Drive Time "not showing to everyone" — the data was shared
fine; the row was just being filtered out for lack of jobs.

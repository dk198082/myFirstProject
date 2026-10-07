---
name: Autoscaled CRM ingestion
description: Why calendar CRM ingestion is driven by both periodic ticks and active board reads
---

The API is published on an autoscaled deployment. In-process intervals do not run when there are no requests, so an active calendar read must also initiate a single-flight ingestion check. A persisted checkpoint lets it resume across instances and cold starts. Do not claim a hard wall-clock latency guarantee for closed calendars or during Dataverse throttling; an always-on worker/scheduler is required for that.

**Why:** A timer-only design silently stops ingesting when autoscale suspends the API, while broad per-user Dataverse polling overloads CRM. The active board refresh provides the wake-up signal without giving each viewer a separate sync loop.

**How to apply:** Keep the request-triggered wake-up and cross-instance lock if changing the ingestion cadence. Leave development ingestion off by default because the development and published apps may point at the same external CRM mirror. For user-initiated direct CRM booking edits, read the confirmed CRM result back into the mirror before claiming the calendar is current; preview writes cannot rely on the disabled dev ingester or a sleeping published process. If that read-back fails after CRM accepted a save, report partial success instead of inviting a duplicate save. A freshness-status request can race the board's first post-idle ingestion and cache an obsolete warning even after the mirror catches up; wait for an active cycle and keep the UI status periodically refreshed while the board is open.
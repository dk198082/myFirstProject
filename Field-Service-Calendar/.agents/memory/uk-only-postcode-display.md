---
name: UK-only postcode display
description: Country-based rule for showing postal codes on schedule chips and calendar reports.
---

Show a postal code on schedule-board chips and Calendar Report output only when the associated CRM country explicitly identifies the United Kingdom. Recognize common UK names/codes and UK constituent countries; do not infer country from the postal-code format.

**Why:** US ZIP codes must remain hidden while UK postcodes remain useful. Country-based filtering avoids misclassifying numeric ZIP codes or unusual valid UK postcodes.

**How to apply:** Carry country alongside postal code for scheduled work orders and CRM-linked Potential Jobs, then use the shared display rule for every chip, preview, PDF, Word, and emailed-PDF location label.
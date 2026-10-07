---
name: Pro Forma app scope
description: Standalone invoice app boundary and authoritative inputs specified by user
---
The Pro Forma Service Invoice must be a new standalone app using the Production Priority Board Design System saved template; do not change the existing Field Service Calendar. Use crm.proposalheader and crm.proposalline, with user-entered CRM Service Order Number and Sales Tax amount, review before PDF generation and local download. No email or Finance notification workflow is requested.

**Why:** The user explicitly replaced the earlier calendar-integrated invoicing proposal with this standalone, document-generation scope.

**How to apply:** Follow the attached Word invoice specification and sample PDFs for document layout, but manual tax amount from the current request takes precedence over automatic tax wording. Verify current proposal views rather than treating the older scheduling catalog as exhaustive.

Use the service order number as the pro forma reference, without allocating a separate invoice number. Freight is an amount entered in the app alongside tax; it is not inferred from CRM or automatically treated as zero.

**Why:** On 2026-10-06 the user resolved both open billing rules explicitly.

**How to apply:** Include entered freight and tax in the reviewed total and PDF; changing either invalidates the previous reviewed document.

The user-provided Production Priority Board Design System export is the authoritative design source for this app.

**Why:** The named saved-template lookup was unavailable, and the user supplied its ZIP export instead. This was not permission to substitute an unrelated design.

**How to apply:** Preserve that supplied system when extending this app.

Users may call the numeric CRM work-order identifier a “Service Order Number,” while the proposal source calls the linked prefixed identifier the service order number.

**Why:** A user entered a numeric work-order number in the service-order lookup and expected to find the corresponding proposal.

**How to apply:** Accept either exact identifier for lookup, distinguish them clearly in the UI, and retain the resolved service-order identifier for the pro forma reference.

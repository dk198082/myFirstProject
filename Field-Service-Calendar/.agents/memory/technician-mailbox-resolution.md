---
name: Technician mailbox resolution
description: The safe source and fallback order for technician email addresses in Microsoft 365 workflows.
---

Use the CRM-linked bookable resource identity to resolve a technician mailbox. Prefer the Field Service primary email, then the linked system user's corporate email or UPN. If those are blank, query Microsoft Graph by the stored Entra object ID (or UPN), never by display name.

**Why:** Display names are not unique, while the bookable-resource → system-user link and Entra object ID identify the intended technician. Microsoft Graph directory fallback requires `User.Read.All` application permission with admin consent; sending still requires `Mail.Send`.

**How to apply:** Keep recipient addresses server-owned. Treat directory lookup failures or missing permissions as an unresolved email and fail closed rather than guessing.
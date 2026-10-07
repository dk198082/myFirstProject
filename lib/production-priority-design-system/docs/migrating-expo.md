# Native migration limits

Read docs/AGENTS.md and docs/consuming-expo.md first. The finished extraction contains web components and portable tokens only. It has no native component, use-colors, use-fonts or native-theme exports.

An Expo consumer may import the portable tokens as described in the consumption guide. Keep its existing native controls and adapters until actual replacements are implemented and verified. Do not delete native theme/hooks/components on the assumption that this package provides them.

Migrating or adding native UI is outside this extraction. Existing board and canvas screens require separate application approval.

# Simplifyr Semantic Model

Canonical registry of *semantic fields* — the vendor-agnostic meaning layer that sits
between source-specific parsed fields and user-defined output.

A semantic field is referenced by a dotted path (e.g. `source.ip`, `network.action`).
Vendor mappings translate source fields into these semantic fields; output profiles
later decide how they are presented to the user.
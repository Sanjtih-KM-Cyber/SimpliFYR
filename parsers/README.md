# Simplifyr Parsers

Deterministic format detection and parsing for heterogeneous event sources.

The parser answers *"how do I structurally read this?"* — vendor semantics are handled
later by the semantic mapping engine, never inside a parser.

Supported formats: Syslog, JSON, XML, CSV, CEF, LEEF, raw text.
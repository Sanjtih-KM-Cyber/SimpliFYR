# Simplifyr Mappings

Field mapping and semantic normalization engine.

A mapping describes how source-specific fields correspond to semantic fields, and how
their values are transformed. This is **data, not code** — adding or changing a vendor
means adding or changing a mapping, never the processing engine.

```python
from simplifyr_mappings import Mapping, FieldMapping, apply_mapping

mapping = Mapping(
    name="VendorX Firewall v1 Traffic",
    fields=[
        FieldMapping("srcip", "source.ip"),
        FieldMapping("dstip", "destination.ip"),
        FieldMapping("proto", "network.protocol"),
        FieldMapping("action", "network.action", {"deny": "BLOCKED", "allow": "ALLOWED"}),
    ],
)

normalized = apply_mapping({"srcip": "10.1.1.5", "action": "deny"}, mapping)
```
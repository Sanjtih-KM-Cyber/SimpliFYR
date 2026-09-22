# Simplifyr Output Profiles

Output profiles determine how a normalized semantic event is represented for a given
consumer. A profile is configuration, not code: users pick a preset or define their own
fields, and the engine renders the semantic event accordingly.

```python
from output_profiles import soc_preset, apply_output_profile

output = apply_output_profile(normalized, soc_preset())
```
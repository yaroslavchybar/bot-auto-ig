The `instagrapi-*.json` fixtures were captured offline from instagrapi 3.0.24
(upstream commit `a3b7538`, 2026-10-13). They contain synthetic values only.

Login parameters use its retained Android 448 app profile, matching our saved
sessions. Device IDs, encryption output, timestamps, input IDs, and verification
contexts are normalized to template variables. Context cases record the result
of its `bloks_extract_two_step_verification_context` method, including reordered
fields, nested server parameters, unrelated app references, and malformed maps.

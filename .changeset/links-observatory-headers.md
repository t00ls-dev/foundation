---
"@t00ls-dev/security": patch
---

Add CSP frame-ancestors 'none' alongside X-Frame-Options DENY to prevent framing
without changing the opt-in Turnstile script and frame allowances.

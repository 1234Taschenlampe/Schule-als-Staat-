# Security hardening — 2026-10-27

Live database migration: `school_directory_privacy_and_throttling_v32`.

- The browser still uses a **public Supabase publishable key** and authenticated REST/RPC over HTTPS. It is not a secret; RLS and server-side authorization remain essential.
- No public `anon` SELECT on public tables; all public data tables have RLS.
- Operator directory search: role-gated on server, min. four literal characters (wildcards rejected), max. ten results, operator e-mail addresses redacted. Administrator privileges unchanged.
- Per-operator database-backed throttle: 20 searches per 10 minutes, 60 per rolling 24-hour window. Private quota schema denies `anon` / `authenticated` access.
- Supabase authenticated `SECURITY DEFINER` RPCs still require case-by-case security review. ViSA's public verification RPC and settings RPC intentionally remain open, with separate verification.
- The roster is not yet imported. Never upload student Excel files to GitHub, browser logs or public storage; do not flip `roster_enforced` until an end-to-end tested, approved import exists.
- Publishing to GitHub does **not** automatically deploy the Cloudflare Worker.
- A full third-party penetration test and school privacy/DSGVO approval are still required; do not label the application absolutely secure.

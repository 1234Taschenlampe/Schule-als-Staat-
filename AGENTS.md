# Canonical V6 direction (supersedes any V3 restoration notes below)

- **Cloudflare is the SOLE official host:** https://schule-als-staat.schule-als-staat-jfe.workers.dev/ — do not publish a second independent GitHub Pages copy. Keep GitHub Pages redirect-only for old links. Repo remains the source of truth; update Cloudflare Worker after approved frontend changes; commits alone do not auto-deploy to Worker.

- **DO NOT restore, publish or link old V3 HTML designs.** Keep the original archived at `archive/SaS_ONE_Prototyp_v3.html` only for feature specification.
- The only user-facing frontend is `index.html` + `app.js` + `features.js` with `styles.css` + `features.css`. One consistent Apple-inspired responsive system.
- All user-facing features must use real Supabase storage and authorization, never fabricated demo purchases, IDs, votes, rentals or news. Incomplete features must state exactly what remains.
- V6 business features live in `supabase/v6_integrated_portal.sql`; safety enhancements in `supabase/v6_1_data_safety.sql` and `supabase/v6_btree_gist_schema_hardening.sql`.
- Test `node --test tests/v6-functional-source-check.mjs`, the existing V4 tests, the static Pages build, and real multi-account flows before claiming readiness.
- Student identity documents and detailed Visa addresses require school authorization/privacy compliance before real rollout.
- **0 EUR total, no paid upgrades or usage.** `docs/V6_IMPLEMENTATION.md` is the status matrix.

# Agent guidelines: Schule als Staat V4

## Goal
Maintain and deploy the responsive school project website, digital internal-currency wallet, school polls, QR checkout, and cash-sales ledger. The final school-state name has **not** been selected; do not hardcode one.

## Cloudflare setup
- Official Cloudflare setup: https://developers.cloudflare.com/agent-setup/codex/
- Cloudflare agent skills: https://github.com/cloudflare/skills
- Cloudflare API MCP over OAuth: https://mcp.cloudflare.com/mcp
- Codex users can install the Cloudflare plugin using `/plugins` in Codex CLI or Plugins in the desktop app. This installation and browser authorization happen on the user's local machine/account, **not automatically by reading this file**.
- Follow current official Cloudflare Pages documentation when changing deployment commands.
- Static build command for this repository: `sh scripts/build-static.sh`.
- Static Pages build output directory: `_site`.
- Production branch: `main`.
- Prefer Git-connected Cloudflare Pages. Cloudflare will provision the `*.pages.dev` HTTPS URL after the first successful deployment. No public URL is known before then.

## Architecture and security
- Frontend consists of `index.html`, `styles.css`, `app.js`, `config.js`.
- Existing backend is Supabase Auth + PostgreSQL with RPCs in `supabase/schema.sql` and `supabase/v4_voting.sql`. A Pages deployment alone does **not** enable accounts, payments or votes.
- Never commit production private API keys, database credentials, Supabase service-role keys, Cloudflare API tokens, personal data or vote records. Only publish a valid public Supabase publishable/anon key in `config.js`.
- Do not silently migrate wallets/votes to KV or a Git repository. Transactions must remain atomic and one-person/one-ballot controls verified; school identity approval and GDPR review are prerequisites.
- Do not claim camera, payment, or polling flows work on every device without real HTTPS-browser and cross-account tests.
- Camera must be started only following explicit user action; include QR-image and manual-link fallback. Avoid iframes, which can block camera permission policies.
- Keep the repo contents distinct from public HTML assets: deploy the output of `scripts/build-static.sh` only.

## Before production
1. Obtain the Cloudflare account owner's OAuth authorization for Cloudflare tooling.
2. Connect Cloudflare Pages to this GitHub repository.
3. Deploy only the generated `_site` directory and verify public URL via HTTPS.
4. Configure Supabase in `config.js` and configure the exact public URL under Supabase Auth redirect URLs. Verify SQL migrations and row-level security.
5. Test payment concurrency, one vote per verified person, admin-only tallies, cash/digital separation, and camera permissions.
6. Obtain school authorization for hosting and personal data processing.

## Non-negotiable zero-cost policy

- Total external operating budget: **EUR 0.00**, including hosting, database, emails, observability, CI, API calls, upgrades, add-ons and transaction providers.
- Only use confirmed free-plan services and free quotas; never add a paid subscription, enable pay-as-you-go, activate an optional billable feature or add a payment method.
- Never automatically upgrade to restore availability. At the free-plan limit, fail closed and notify the project administrator; no surprise charges.
- Check the actual connected account plan and current free limits before creating any new resource. Do not rely on static marketing limits.
- Never interpret an application-internal virtual wallet as authorization for payments to an external provider.
- Existing Supabase project was confirmed on free tier; Cloudflare Pages project exists but GitHub source connection currently fails with Cloudflare error 8000011. Do not claim successful Cloudflare deployment until verified.

## Aktueller Deployment-Workaround (16.10.2026)

Das GitHub-Sync von Cloudflare Pages ist derzeit durch den Cloudflare-Fehler `8000011` blockiert. Ein statischer Cloudflare Workers Free-Worker namens `schule-als-staat` wurde stattdessen über die Cloudflare-API deployed und auf `https://schule-als-staat.schule-als-staat-jfe.workers.dev/` aktiviert. Die Webseite ist ein GitHub-Snapshot mit vier öffentlichen Dateien. Es erfolgt **kein automatisches Redeployment** auf Worker bei Push; der Generator `node scripts/build-worker.mjs` stellt den gleichen Stand reproduzierbar bereit. Das Cloudflare Pages Projekt `schule-als-staat` bleibt ohne Deployment. Eine unabhängige externe HTTP-Prüfung war in dieser Arbeitsumgebung nicht möglich.

Vor Produktionsnutzung sind echte Kamera-, Login-, Autorisierungs-, Polling- und Zahlungs-End-to-End-Tests sowie schulische Zustimmung erforderlich. Insbesondere reicht das standardmäßige Supabase-Mail-Limit nicht für eine Masseneinschreibung. Die 0-EUR-Grenze ist bindend.

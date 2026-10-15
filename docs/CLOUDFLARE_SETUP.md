# Cloudflare setup – Schule als Staat V4

## A. Connect your coding agent to Cloudflare

Official Codex guide: https://developers.cloudflare.com/agent-setup/codex/

**Codex Desktop:** Open Plugins, search for **Cloudflare**, install it, and start a new session.

**Codex CLI (WSL2 recommended for Windows):**
1. Open the local repository in your shell.
2. Start Codex: `codex`
3. Run `/plugins` and install **Cloudflare**, which bundles relevant skills and the Cloudflare MCP connection.
4. If manual MCP configuration is needed, use:
   ```bash
   codex mcp add cloudflare --url https://mcp.cloudflare.com/mcp
   codex mcp list
   ```
5. Complete the Cloudflare OAuth authorization in your browser **yourself** when prompted, granting only required scopes. Do not paste authorization tokens into ChatGPT or GitHub.

The Cloudflare agent configuration does **not** automatically deploy the site. Agent plugin installation is local to the coding-agent environment. Standard ChatGPT chats do not gain account access unless a compatible Cloudflare integration has actually been connected.

## B. Deploy V4 with Cloudflare Pages

Official static website guide: https://developers.cloudflare.com/pages/framework-guides/deploy-anything/
Official Git integration guide: https://developers.cloudflare.com/pages/get-started/git-integration/

1. Log in at https://dash.cloudflare.com/ and choose the correct account.
2. Open **Workers & Pages** → **Create application** → **Pages** → **Import an existing Git repository**.
3. Connect GitHub and authorize access to `1234Taschenlampe/Schule-als-Staat-`.
4. Configure exactly:

| Field | Value |
| --- | --- |
| Project name | Your chosen available name, e.g. `schule-als-staat` |
| Framework preset | None (static HTML) |
| Production branch | `main` |
| Build command | `sh scripts/build-static.sh` |
| Build output directory | `_site` |
| Root directory | Repository root (default) |

5. Select **Save and Deploy**. After successful deployment, open the **actual URL shown by Cloudflare**. The URL is assigned by Cloudflare; do not assume a guessed `*.pages.dev` address is live.
6. Test direct HTTPS navigation and camera permissions on supported devices.

This repository already contains the static build script. No Node/React or Wrangler dependency is needed for the Git-connected Pages deployment.

## C. Backend is a separate step

Cloudflare Pages only publishes the user interface. V4 currently expects Supabase, not Cloudflare D1. Before live payments or polls:

1. Create or connect a Supabase project (ensure school approval and data processing requirements).
2. Apply `supabase/schema.sql` followed by `supabase/v4_voting.sql` in a controlled database.
3. Add the Supabase project URL and **public publishable/anon key only** to `config.js`. Never commit service-role keys or database passwords.
4. Under Supabase **Authentication → URL Configuration**, configure the actual Cloudflare deployment URL and required redirect URLs.
5. Verify email authentication, role administration, one vote per eligible account, live tally, digital wallet payments, cash sales, camera permissions, and transaction rollback.

## D. School domain later

The school IT team may attach a subdomain or arrange reverse proxy/subpath hosting; this requires control of its domain/DNS configuration. A direct HTTPS site is preferable to iframe embedding because iframe permissions can obstruct camera access.

## E. Existing GitHub Pages

GitHub Pages can continue as a separate, static preview. Connecting Cloudflare does not automatically disable GitHub Pages. If both are used, configure auth redirect URLs for each trusted origin or select one canonical production address.

## Limits

Do not claim production operation until the Cloudflare account has been connected, build succeeded, actual site URL verified, backend configured, and full flow tested.

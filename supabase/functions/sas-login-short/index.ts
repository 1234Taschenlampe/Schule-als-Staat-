// SAS identifiers are public aliases. Supabase Auth verifies every supplied password.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { boundedText } from "../_shared/body.js";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const portal = "https://schule-als-staat.schule-als-staat-jfe.workers.dev";
const invalid = "Kennung oder Passwort ist falsch.";
const quotaSecret = Deno.env.get("SAS_LOGIN_QUOTA_HMAC_KEY") ?? "";
const encoder = new TextEncoder();
const quotaKey = quotaSecret.length >= 32
  ? crypto.subtle.importKey("raw", encoder.encode(quotaSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  : null;

const unavailable = "Anmeldung vorübergehend nicht verfügbar.";

Deno.serve(async (request) => {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  });
  const origin = request.headers.get("origin");
  if (origin === portal) headers.set("Access-Control-Allow-Origin", portal);
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers });
  if (origin && origin !== portal) return reply(403, { error: "Nicht erlaubt." });
  if (request.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Headers", "apikey, authorization, content-type, x-client-info");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") return reply(405, { error: "Nicht erlaubt." });

  let input;
  try {
    const raw = await boundedText(request, 2048);
    if (raw === null) return reply(400, { error: "Ungültige Anfrage." });
    input = JSON.parse(raw);
  } catch {
    return reply(400, { error: "Ungültige Anfrage." });
  }
  try {
    const login = typeof input?.login_id === "string" ? input.login_id.trim().toUpperCase() : "";
    const password = typeof input?.password === "string" ? input.password : "";
    if (!/^SAS-(?:[0-9]{6}|[A-Z0-9]{10})$/.test(login) || !password || password.length > 200) {
      return reply(401, { error: invalid });
    }
    if (!quotaKey) return reply(503, { error: unavailable });
    const digest = await crypto.subtle.sign("HMAC", await quotaKey, encoder.encode(login));
    const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const { data: allowed, error: quotaError } = await admin.rpc("sas_consume_login_quota", { p_alias_key: key });
    if (quotaError || typeof allowed !== "boolean") return reply(503, { error: unavailable });
    if (!allowed) {
      headers.set("Retry-After", "60");
      return reply(429, { error: "Zu viele Anmeldeversuche. Bitte warte kurz." });
    }

    const field = login.length === 10 ? "short_login_id" : "login_id";
    const { data: roster, error } = await admin.from("school_roster_members")
      .select("login_id").eq(field, login).eq("active", true).maybeSingle();
    if (error) return reply(503, { error: unavailable });
    const alias = roster?.login_id.slice(4).toLowerCase() ?? "not-registered";
    const authResult = await fetch(url + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": anonKey, "Cache-Control": "no-store" },
      body: JSON.stringify({ email: alias + "@accounts.schule-als-staat.invalid", password }),
    });
    if (authResult.status === 429) return reply(429, { error: "Zu viele Anmeldeversuche. Bitte warte kurz." });
    if (authResult.status >= 500) return reply(503, { error: unavailable });
    if (!authResult.ok || !roster) return reply(401, { error: invalid });
    const session = await authResult.json();
    if (!session.access_token || !session.refresh_token) return reply(503, { error: unavailable });
    return reply(200, { access_token: session.access_token, refresh_token: session.refresh_token });
  } catch {
    return reply(503, { error: unavailable });
  }
});

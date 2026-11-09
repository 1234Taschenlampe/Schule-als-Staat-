// Citizen short-ID login. Never logs or returns plaintext names or account lookup details.
// Credential verification remains entirely with Supabase Auth.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const allowedOrigins = new Set(["https://schule-als-staat.schule-als-staat-jfe.workers.dev"]);

function reply(body: Record<string, unknown>, status: number, origin: string) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async req => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") {
    const response = reply({}, 204, origin);
    response.headers.set("Access-Control-Allow-Headers", "apikey, authorization, content-type, x-client-info");
    response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    return response;
  }
  if (req.method !== "POST") return reply({ error: "Nicht erlaubt." }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return reply({ error: "Nicht erlaubt." }, 403, origin);
  if (Number(req.headers.get("content-length") || 0) > 2048) return reply({ error: "Ungültige Anfrage." }, 400, origin);

  try {
    const input = await req.json();
    const login = String(input?.login_id || "").trim().toUpperCase();
    const password = typeof input?.password === "string" ? input.password : "";
    if (!/^SAS-[0-9]{6}$/.test(login) || password.length < 6 || password.length > 200) {
      return reply({ error: "Kennung oder Passwort falsch." }, 401, origin);
    }

    // No name lookup: a short alias maps to the previous synthetic Supabase Auth email.
    const { data: roster, error: lookupError } = await admin.from("school_roster_members")
      .select("login_id").eq("short_login_id", login).eq("active", true).maybeSingle();
    if (lookupError) return reply({ error: "Anmeldung vorübergehend nicht verfügbar." }, 503, origin);
    const legacy = /^SAS-[A-Z2-9]{10}$/.test(roster?.login_id || "") ? roster!.login_id : "";
    const authEmail = legacy
      ? legacy.slice(4).toLowerCase() + "@accounts.schule-als-staat.invalid"
      : "not-registered@accounts.schule-als-staat.invalid";
    const authResult = await fetch(url + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": anonKey, "Cache-Control": "no-store" },
      body: JSON.stringify({ email: authEmail, password }),
    });
    if (!authResult.ok) return reply({ error: "Kennung oder Passwort falsch." }, 401, origin);
    const session = await authResult.json();
    if (!session?.access_token || !session?.refresh_token) {
      return reply({ error: "Anmeldung vorübergehend nicht verfügbar." }, 503, origin);
    }
    return reply({ access_token: session.access_token, refresh_token: session.refresh_token }, 200, origin);
  } catch {
    return reply({ error: "Anmeldung vorübergehend nicht verfügbar." }, 503, origin);
  }
});

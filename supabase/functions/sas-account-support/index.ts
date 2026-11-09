// Recovery is only available to an active SAS administrator session.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const portal = "https://schule-als-staat.schule-als-staat-jfe.workers.dev";
const unavailable = "Die Kontenhilfe ist gerade nicht verfügbar. Bitte erneut versuchen.";
const denied = "Für die Kontenhilfe ist eine gültige Administrator-Anmeldung erforderlich.";

function temporaryPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return "Sas-" + btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_") + "7";
}

Deno.serve(async (request) => {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  });
  const origin = request.headers.get("origin");
  if (origin === portal) headers.set("Access-Control-Allow-Origin", portal);
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers });
  if (origin && origin !== portal) return reply(403, { error: denied });
  if (request.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Headers", "apikey, authorization, content-type, x-client-info");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") return reply(405, { error: denied });
  const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!token || token.length > 8192) return reply(401, { error: denied });

  try {
    const { data: identity, error: authError } = await service.auth.getUser(token);
    if (authError || !identity.user) return reply(401, { error: denied });
    // Read the session claim only after Auth has verified this exact JWT.
    const encoded = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    const sessionId = JSON.parse(atob(encoded)).session_id;
    if (typeof sessionId !== "string") return reply(401, { error: denied });
    const raw = await request.text();
    if (raw.length > 1024) return reply(400, { error: "Ungültige Anfrage." });
    const input = JSON.parse(raw);
    const login = typeof input?.login_id === "string" ? input.login_id.trim().toUpperCase() : "";
    const reset = input?.action === "reset";
    if ((!reset && input?.action !== "lookup") || !/^SAS-(?:[0-9]{6}|[A-Z2-9]{10})$/.test(login)) {
      return reply(400, { error: "Bitte gib die vollständige Bürgerkennung ein." });
    }
    if (reset && input.identity_checked !== true) {
      return reply(400, { error: "Bitte bestätige die persönliche Identitätsprüfung." });
    }
    const { data, error } = await service.rpc("sas_account_support", {
      p_actor: identity.user.id, p_session: sessionId, p_login: login, p_reset: reset,
    });
    if (error) return reply(503, { error: unavailable });
    switch (data?.status) {
      case "forbidden": return reply(403, { error: denied });
      case "missing": return reply(404, { error: "Zu dieser Kennung wurde kein Schülerkonto gefunden." });
      case "blocked": return reply(409, { error: "Für dieses Konto ist kein Passwort-Reset verfügbar." });
      case "limited": return reply(429, { error: "Bitte warte einige Minuten, bevor du einen weiteren Reset startest." });
    }
    if (!data?.login_id || (reset && (!data.target || !data.attempt))) return reply(503, { error: unavailable });
    if (!reset) return reply(200, { login_id: data.login_id, status: data.status });

    const password = temporaryPassword();
    const result = await service.auth.admin.updateUserById(data.target, {
      password,
      app_metadata: { sas_support_attempt: data.attempt, sas_initial_password: true },
    });
    if (result.error) return reply(503, { error: "Der Reset konnte nicht bestätigt werden. Bitte warte kurz und prüfe das Konto erneut." });
    // Only return the secret after the Auth transaction's audit trigger has confirmed success.
    const { data: completed, error: auditError } = await service.from("school_password_reset_audit")
      .select("status").eq("id", data.attempt).single();
    if (auditError || completed?.status !== "completed") return reply(503, { error: unavailable });
    return reply(200, { login_id: data.login_id, temporary_password: password });
  } catch (error) {
    if (error instanceof SyntaxError) return reply(400, { error: "Ungültige Anfrage." });
    return reply(503, { error: unavailable });
  }
});

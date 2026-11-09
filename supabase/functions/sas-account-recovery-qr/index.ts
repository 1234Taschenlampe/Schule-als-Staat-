// Admin-only, no-email QR password recovery for official SAS citizen accounts.
// The one-time recovery token is issued by Supabase Auth and never persisted here.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { readInput } from "../_shared/sas-http.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const portal = "https://schule-als-staat.schule-als-staat-jfe.workers.dev";
const denied = "Nur eine aktive Administrator-Anmeldung darf einen Reset-QR ausgeben.";
const unavailable = "Der Reset-QR konnte nicht erstellt werden. Bitte beim IT-Support erneut versuchen.";

function randomTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return "Sa!" + Array.from(bytes, b => alphabet[b & 31]).join("");
}

Deno.serve(async (request: Request): Promise<Response> => {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  });
  const origin = request.headers.get("origin");
  if (origin === portal) headers.set("Access-Control-Allow-Origin", portal);
  const reply = (status: number, body: object) =>
    new Response(JSON.stringify(body), { status, headers });
  if (origin && origin !== portal) return reply(403, { error: denied });
  if (request.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Headers", "apikey, authorization, content-type, x-client-info");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") return reply(405, { error: denied });

  const jwt = /^Bearer (\S+)$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!jwt || jwt.length > 8192) return reply(401, { error: denied });

  try {
    // Supabase Auth validates the access JWT; user metadata cannot confer admin rights.
    const { data: identity, error: authError } = await service.auth.getUser(jwt);
    if (authError || !identity.user) return reply(401, { error: denied });
    const pieces = jwt.split(".");
    if (pieces.length !== 3) return reply(401, { error: denied });
    const claim = JSON.parse(atob(pieces[1].replaceAll("-", "+").replaceAll("_", "/")));
    const sessionId = claim.session_id;
    if (typeof sessionId !== "string") return reply(401, { error: denied });

    const input = await readInput(request);
    const login = typeof input?.login_id === "string" ? input.login_id.trim().toUpperCase() : "";
    if (!/^SAS-(?:[0-9]{6}|[A-Z2-9]{10})$/.test(login) || input?.identity_checked !== true) {
      return reply(400, { error: "Bitte Bürgerkennung eingeben und Identität persönlich prüfen." });
    }

    // Existing SQL checks admin role, active Auth session, target eligibility and
    // globally locked per-admin and per-student rate limits before reserving audit.
    const { data: reservation, error: reservationError } = await service.rpc("sas_account_support", {
      p_actor: identity.user.id, p_session: sessionId, p_login: login, p_reset: true,
    });
    if (reservationError) return reply(503, { error: unavailable });
    switch (reservation?.status) {
      case "forbidden": return reply(403, { error: denied });
      case "missing": return reply(404, { error: "Bürgerkonto nicht gefunden." });
      case "blocked": return reply(409, { error: "Das Konto ist für eine Wiederherstellung gesperrt." });
      case "limited": return reply(429, { error: "Zu viele Resets. Bitte später erneut versuchen." });
    }
    if (!reservation?.target || !reservation?.attempt || !reservation?.login_id) {
      return reply(503, { error: unavailable });
    }

    const { data: userRecord, error: userError } = await service.auth.admin.getUserById(reservation.target);
    const email = userRecord?.user?.email || "";
    // The technical alias is never exposed to students and never receives mail.
    if (userError || !/^[a-z0-9]{10}@accounts\.schule-als-staat\.invalid$/i.test(email)) {
      return reply(503, { error: unavailable });
    }

    // Invalidate the former password first. The existing DB trigger ensures
    // the audit reservation belongs to this non-admin student and marks completion.
    const { error: changeError } = await service.auth.admin.updateUserById(reservation.target, {
      password: randomTemporaryPassword(),
      app_metadata: { sas_support_attempt: reservation.attempt, sas_initial_password: true },
    });
    if (changeError) return reply(503, { error: unavailable });
    const { data: audit, error: auditError } = await service.from("school_password_reset_audit")
      .select("status").eq("id", reservation.attempt).single();
    if (auditError || audit?.status !== "completed") return reply(503, { error: unavailable });

    // generateLink does NOT dispatch an e-mail. Auth issues an expiring,
    // single-use recovery token; its lifetime follows Auth OTP settings.
    const { data: recovery, error: recoveryError } = await service.auth.admin.generateLink({
      type: "recovery", email, options: { redirectTo: portal + "/" },
    });
    const token = recovery?.properties?.hashed_token;
    if (recoveryError || typeof token !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) {
      // The password is already invalidated. Staff can issue another recovery
      // after the existing rate limit; never reveal the unknown temporary secret.
      return reply(503, { error: "Passwort gesperrt, aber QR konnte nicht erstellt werden. Bitte IT-Support kontaktieren." });
    }

    return reply(200, {
      login_id: reservation.login_id,
      recovery_link: portal + "/#sas-reset=" + encodeURIComponent(token),
    });
  } catch {
    return reply(503, { error: unavailable });
  }
});

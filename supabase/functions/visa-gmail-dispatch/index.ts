// Cloud-only ViSA verification dispatcher: Supabase queue -> Gmail API.
// Never expose refresh tokens, OAuth client secrets, or mail queue tokens to browsers.
// It is intentionally inert until a separate operator enables email_enabled,
// sets Gmail secrets, and schedules authenticated invocations.
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const json = (status, value) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" }
});

function timingSafeEqual(a, b) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }
  return diff === 0;
}

function encodeBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function asBase64Url(value) {
  return encodeBase64(new TextEncoder().encode(value))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function rpc(name, values) {
  if (!supabaseUrl || !serviceKey) throw Error("Supabase runtime credentials absent");
  const response = await fetch(supabaseUrl + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      "apikey": serviceKey,
      "authorization": "Bearer " + serviceKey,
      "content-type": "application/json"
    },
    body: JSON.stringify(values)
  });
  if (!response.ok) throw Error("Supabase RPC " + name + " returned " + response.status);
  return await response.json();
}

async function authorizeGmail(clientId, clientSecret, refreshToken) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    }).toString()
  });
  if (!response.ok) throw Error("Gmail OAuth token renewal failed (" + response.status + ")");
  const token = await response.json();
  if (typeof token.access_token !== "string" || !token.access_token) {
    throw Error("Gmail did not return an access token");
  }
  return token.access_token;
}

function prepareMessage(item, sender) {
  const recipient = String(item.recipient || "");
  const token = String(item.token || "");
  const mailId = String(item.id || "");
  if (!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(recipient)
      || !/^[0-9a-f]{64}$/.test(token)
      || !/^[0-9a-f-]{36}$/i.test(mailId)) {
    throw Error("Mail queue entry rejected by validation");
  }
  const link = "https://schule-als-staat.schule-als-staat-jfe.workers.dev/#visa-verify=" + token;
  const subject = "=?UTF-8?B?" +
    encodeBase64(new TextEncoder().encode("Schule als Staat: ViSA-E-Mail bestätigen")) + "?=";
  const body = [
    "Du hast ein ViSA für Schule als Staat angefragt.",
    "",
    "Bitte bestätige die E-Mail-Adresse mit folgendem Link:",
    link,
    "",
    "Dieser Link ist sieben Tage gültig.",
    "Falls du keinen Antrag gestellt hast, ignoriere diese Nachricht.",
    "Es wird durch diese E-Mail keine Zahlung ausgelöst."
  ].join("\r\n");
  const mime = [
    "From: Schule als Staat <" + sender + ">",
    "To: " + recipient,
    "Subject: " + subject,
    "Message-ID: <visa-" + mailId + "@mail.schule-als-staat.invalid>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "Auto-Submitted: auto-generated",
    "",
    encodeBase64(new TextEncoder().encode(body)),
    ""
  ].join("\r\n");
  return asBase64Url(mime);
}

async function sendViaGmail(token, message) {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      "authorization": "Bearer " + token,
      "content-type": "application/json"
    },
    body: JSON.stringify({ raw: message })
  });
  if (!response.ok) throw Error("Gmail send failed (" + response.status + ")");
  const result = await response.json();
  if (typeof result.id !== "string" || !result.id) {
    throw Error("Gmail response did not confirm a message ID");
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  const dispatcherSecret = Deno.env.get("VISA_GMAIL_DISPATCH_SECRET") || "";
  const supplied = request.headers.get("authorization") || "";
  if (dispatcherSecret.length < 32 ||
      !timingSafeEqual(supplied, "Bearer " + dispatcherSecret)) {
    return json(401, { error: "Unauthorized" });
  }
  const clientId = Deno.env.get("GMAIL_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET") || "";
  const refreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN") || "";
  const sender = Deno.env.get("GMAIL_SENDER_EMAIL") || "";

  // Before claiming a mail, fail safely if any provider credential is missing.
  if (!clientId.endsWith(".apps.googleusercontent.com") ||
      !clientSecret || !refreshToken || !/^[^@\s<>]+@[^@\s<>]+\.[A-Za-z]{2,}$/.test(sender)) {
    return json(503, { error: "Gmail sender not configured" });
  }
  // Authorized configuration check: validates Gmail OAuth refresh without sending mail
  // or leasing any queued verification messages.
  let mode = "dispatch";
  try {
    const body = await request.json();
    if (typeof body?.mode === "string") mode = body.mode;
  } catch {
    // An empty POST body is an ordinary dispatch request.
  }
  if (mode !== "check" && mode !== "dispatch") {
    return json(400, { error: "Unsupported operation" });
  }
  try {
    const settings = await rpc("visa_public_settings", {});
    if (mode === "check") {
      await authorizeGmail(clientId, clientSecret, refreshToken);
      return json(200, {
        ok: true,
        oauth_refresh_valid: true,
        email_enabled: settings?.email_enabled === true,
        turnstile_site_key_present: Boolean(settings?.turnstile_site_key),
        sent_messages: 0,
        note: "Token refresh only; Gmail sending not tested"
      });
    }
    if (settings?.email_enabled !== true) {
      return json(503, { error: "ViSA email delivery is disabled" });
    }
    // Renew the access token BEFORE claiming messages, to avoid unnecessary retries.
    const gmailAccessToken = await authorizeGmail(clientId, clientSecret, refreshToken);

    // Keep batches small: the SQL queue independently caps dispatch per day.
    const desired = Math.min(2, Math.max(1, Number(Deno.env.get("VISA_GMAIL_BATCH_SIZE") || 1)));
    const claimed = await rpc("visa_mail_claim", { p_limit: desired });
    if (!Array.isArray(claimed)) throw Error("Queue returned unexpected format");

    let sent = 0;
    let retried = 0;
    let ackFailed = 0;
    for (const item of claimed) {
      let okay = false;
      let error = "";
      try {
        const message = prepareMessage(item, sender);
        await sendViaGmail(gmailAccessToken, message);
        okay = true;
        sent++;
      } catch (e) {
        error = String(e?.message || "Mail dispatch failed").slice(0, 100);
        retried++;
      }
      try {
        await rpc("visa_mail_ack", {
          p_id: item.id,
          p_success: okay,
          p_error: error
        });
      } catch (_) {
        // The queue leases a message for 15 minutes, then may retry.
        // Do not leak the recipient or confirmation token into logs.
        ackFailed++;
      }
    }
    return json(200, { claimed: claimed.length, sent, retried, ackFailed });
  } catch (e) {
    console.error("ViSA Gmail dispatch failed:", String(e?.message || e).slice(0,140));
    return json(503, { error: "Gmail dispatch unavailable" });
  }
});

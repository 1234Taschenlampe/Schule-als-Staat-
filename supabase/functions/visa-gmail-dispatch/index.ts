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
  if (!response.ok) {
    const reason = await response.json().catch(() => ({}));
    const known = ["invalid_grant","invalid_client","unauthorized_client","invalid_request","access_denied"];
    const code = known.includes(reason?.error) ? reason.error : "unclassified_google_error";
    throw Error("Gmail OAuth token renewal failed (" + response.status + ", " + code + ")");
  }
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


function resendMessage(item, from) {
 const email=String(item.recipient||"");const token=String(item.token||"");const id=String(item.id||"");
 if(!/^[^\s@<>\r\n]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)||!/^[0-9a-f]{64}$/.test(token)||!/^[0-9a-f-]{36}$/i.test(id))throw Error("Invalid mail queue item");
 return {from,to:[email],subject:"Schule als Staat: ViSA bestätigen",
 text:"Bitte bestätige deine ViSA-E-Mail-Adresse:\nhttps://schule-als-staat.schule-als-staat-jfe.workers.dev/#visa-verify="+token+"\n\nGültigkeit: 7 Tage. Es wird nichts abgebucht."};
}
async function sendResend(item,from,key){
 const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{
 "authorization":"Bearer "+key,"content-type":"application/json",
 "Idempotency-Key":"sas-visa-"+item.id},body:JSON.stringify(resendMessage(item,from))});
 if(!r.ok)throw Error("Resend HTTP "+r.status);
 const data=await r.json();
 if(typeof data.id!=="string"||!data.id)throw Error("Resend message not accepted");
}

// The pg_cron caller uses its own strong credential generated inside Supabase Vault.
// Validate it using a restricted, service_role-only RPC; never return or log the token.
async function authorizedViaVault(authHeader) {
  if (!/^Bearer [a-f0-9]{64}$/.test(authHeader)) return false;
  if (!supabaseUrl || !serviceKey) return false;
  try {
    const token = authHeader.slice("Bearer ".length);
    const result = await fetch(supabaseUrl + "/rest/v1/rpc/visa_gmail_vault_authorize", {
      method: "POST",
      headers: {
        "apikey": serviceKey,
        "authorization": "Bearer " + serviceKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({ p_token: token })
    });
    return result.ok && (await result.json()) === true;
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  const dispatcherSecret = Deno.env.get("VISA_GMAIL_DISPATCH_SECRET") || "";
  const supplied = request.headers.get("authorization") || "";
  const configuredSecretValid = dispatcherSecret.length >= 32 &&
    timingSafeEqual(supplied, "Bearer " + dispatcherSecret);
  if (!configuredSecretValid && !(await authorizedViaVault(supplied))) {
    return json(401, { error: "Unauthorized" });
  }
  const provider=Deno.env.get("VISA_EMAIL_PROVIDER")||"gmail";
  if(!["gmail","resend"].includes(provider))return json(503,{error:"Unrecognized mail provider"});
  const clientId=Deno.env.get("GMAIL_CLIENT_ID")||"";
  const clientSecret=Deno.env.get("GMAIL_CLIENT_SECRET")||"";
  const refreshToken=Deno.env.get("GMAIL_REFRESH_TOKEN")||"";
  const sender=Deno.env.get("GMAIL_SENDER_EMAIL")||"";
  const resendKey=Deno.env.get("RESEND_API_KEY")||"";
  const resendFrom=Deno.env.get("RESEND_FROM_EMAIL")||"";
  if(provider==="gmail"&&(!clientId.endsWith(".apps.googleusercontent.com")||!clientSecret||!refreshToken||!/^[^@\s<>]+@[^@\s<>]+\.[A-Za-z]{2,}$/.test(sender)))
    return json(503,{error:"Gmail sender not configured"});
  if(provider==="resend"&&(!/^re_[A-Za-z0-9_-]{12,}$/.test(resendKey)||!/^[^@\s<>]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}$/.test(resendFrom)||resendFrom.toLowerCase().endsWith("@resend.dev")))
    return json(503,{error:"Resend sender not configured"});
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
    if(mode==="check"){
      if(provider==="gmail"){
        await authorizeGmail(clientId,clientSecret,refreshToken);
        return json(200,{ok:true,oauth_refresh_valid:true,email_enabled:settings?.email_enabled===true,
        turnstile_site_key_present:Boolean(settings?.turnstile_site_key),sent_messages:0,note:"Token refresh only; Gmail sending not tested"});
      }
      return json(200,{ok:true,provider:"resend",configuration_present:true,verified_delivery:false,
      sent_messages:0,email_enabled:settings?.email_enabled===true,turnstile_site_key_present:Boolean(settings?.turnstile_site_key),
      note:"Format check only; a real delivery test is required"});
    }
    if (settings?.email_enabled !== true) {
      return json(503, { error: "ViSA email delivery is disabled" });
    }
    // Renew the access token BEFORE claiming messages, to avoid unnecessary retries.
    const gmailAccessToken = provider==="gmail" ? await authorizeGmail(clientId,clientSecret,refreshToken) : null;

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
        if(provider==="resend")await sendResend(item,resendFrom,resendKey);
        else await sendViaGmail(gmailAccessToken,prepareMessage(item,sender));
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
    const diagnostic = String(e?.message || e).slice(0,140);
    console.error("ViSA dispatch failed:", diagnostic);
    // Only authenticated check-mode callers receive a classified Google error.
    // No token, client secret or Google response payload is returned.
    if (mode === "check" && provider === "gmail") {
      const code = (diagnostic.match(/invalid_grant|invalid_client|unauthorized_client|invalid_request|access_denied/) || [])[0] || "unclassified";
      return json(503, { error: "Gmail OAuth preflight failed", oauth_error_code: code });
    }
    return json(503, { error: "ViSA email dispatch unavailable" });
  }
});

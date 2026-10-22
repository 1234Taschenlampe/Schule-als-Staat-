#!/usr/bin/env python3
"""School-state ViSA verification mail sender for Raspberry Pi.

Runs on the Pi, not in a browser. Only connects to the narrowly scoped Supabase
mail bridge, never uses the database service_role credential.
No mail gets sent until all required environment variables are configured.
"""
import json
import os
import smtplib
import ssl
import sys
import time
import urllib.request
from email.message import EmailMessage
from urllib.parse import urlsplit


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing {name}")
    return value


BRIDGE_URL = required("VISA_MAIL_BRIDGE_URL")
BRIDGE_KEY = required("VISA_MAIL_WORKER_SECRET")
SMTP_HOST = required("VISA_SMTP_HOST")
SMTP_PORT = int(os.environ.get("VISA_SMTP_PORT", "587"))
SMTP_USER = required("VISA_SMTP_USERNAME")
SMTP_PASSWORD = required("VISA_SMTP_PASSWORD")
SENDER = required("VISA_SENDER_EMAIL")
FROM_NAME = os.environ.get("VISA_SENDER_NAME", "Schule als Staat")
BASE_URL = "https://schule-als-staat.schule-als-staat-jfe.workers.dev/"
MAX_PER_RUN = min(20, max(1, int(os.environ.get("VISA_MAX_EMAILS_PER_RUN", "10"))))
MIN_SECONDS = max(2, float(os.environ.get("VISA_MIN_SECONDS_BETWEEN_SENDS", "3")))

parsed = urlsplit(BRIDGE_URL)
if parsed.scheme != "https" or parsed.hostname != "wdebwgcferieedkpqbvk.supabase.co":
    raise RuntimeError("Mail bridge must be on the configured HTTPS Supabase project.")
if not BRIDGE_URL.endswith("/functions/v1/visa-mail-bridge"):
    raise RuntimeError("Unexpected bridge URL path.")
if len(BRIDGE_KEY) < 32:
    raise RuntimeError("The worker secret must be at least 32 characters.")


def request_bridge(message: dict) -> dict:
    payload = json.dumps(message).encode("utf-8")
    req = urllib.request.Request(
        BRIDGE_URL,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + BRIDGE_KEY,
        },
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.loads(response.read(250_000))


def send_mail(recipient: str, token: str, mail_id: str) -> None:
    if len(token) != 64 or any(c not in "0123456789abcdef" for c in token):
        raise ValueError("Invalid email verification token")
    link = BASE_URL + "#visa-verify=" + token
    mail = EmailMessage()
    mail["Subject"] = "Schule als Staat: Bitte E-Mail-Adresse bestätigen"
    mail["From"] = f"{FROM_NAME} <{SENDER}>"
    mail["To"] = recipient
    # Stable identifier helps avoid ambiguous retries on the recipient side.
    mail["Message-ID"] = f"<visa-{mail_id}@schule-als-staat.local>"
    mail.set_content(
        "Du hast ein ViSA für Schule als Staat angefragt.\n\n"
        "Bitte bestätige deine E-Mail-Adresse mit diesem Link:\n"
        + link
        + "\n\nDer Link ist sieben Tage gültig.\n"
        "Wenn du keinen Antrag gestellt hast, kannst du die Nachricht ignorieren.\n"
        "Du musst noch nichts bezahlen.\n"
    )
    context = ssl.create_default_context()
    if SMTP_PORT == 465:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=25, context=context) as smtp:
            smtp.login(SMTP_USER, SMTP_PASSWORD)
            smtp.send_message(mail)
    elif SMTP_PORT == 587:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=25) as smtp:
            smtp.ehlo()
            smtp.starttls(context=context)
            smtp.ehlo()
            smtp.login(SMTP_USER, SMTP_PASSWORD)
            smtp.send_message(mail)
    else:
        raise RuntimeError("Only SMTP STARTTLS/587 or SMTPS/465 is permitted.")


def main() -> int:
    batch = request_bridge({"action": "claim", "limit": MAX_PER_RUN}).get("items", [])
    success_count = 0
    for item in batch:
        is_ok = False
        error = ""
        try:
            send_mail(item["recipient"], item["token"], item["id"])
            is_ok = True
            success_count += 1
        except Exception as exc:
            error = type(exc).__name__
        try:
            request_bridge(
                {"action": "ack", "id": item["id"], "success": is_ok, "error": error}
            )
        except Exception:
            # Acknowledgement failures are retried by the queue lease timeout.
            print("Warning: mail acknowledgement failed", file=sys.stderr)
        time.sleep(MIN_SECONDS)
    print(f"ViSA mail queue: processed {len(batch)}, successful {success_count}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print("ViSA mail worker unavailable:", type(exc).__name__, file=sys.stderr)
        raise SystemExit(1)

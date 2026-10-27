#!/usr/bin/env bash
# Non-interactive, idempotent installer. It never receives or stores credentials.
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then echo 'Run with sudo, on the intended cluster3 host.' >&2; exit 1; fi
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
test -f "${root}/scripts/visa-mail-worker.py"
test -f "${root}/scripts/visa-mail-systemd/sas-visa-mail.service"
test -f "${root}/scripts/visa-mail-systemd/sas-visa-mail.timer"
if ! id -u sas-visa-mail >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin sas-visa-mail
fi
install -d -o root -g root -m 0755 /opt/sas-visa-mail
install -o root -g root -m 0644 "${root}/scripts/visa-mail-worker.py" /opt/sas-visa-mail/visa-mail-worker.py
install -o root -g root -m 0644 "${root}/scripts/visa-mail-systemd/sas-visa-mail.service" /etc/systemd/system/sas-visa-mail.service
install -o root -g root -m 0644 "${root}/scripts/visa-mail-systemd/sas-visa-mail.timer" /etc/systemd/system/sas-visa-mail.timer
systemctl daemon-reload
if [[ -f /etc/sas-visa-mail.env ]]; then
  chmod 0600 /etc/sas-visa-mail.env
  chown root:root /etc/sas-visa-mail.env
  echo 'Installed. Credentials file exists; validate its contents and bridge availability before enabling.'
else
  echo 'Installed but not enabled. Store secrets locally in /etc/sas-visa-mail.env (root:root 0600), then enable timer.'
fi
echo 'To enable after verification: sudo systemctl enable --now sas-visa-mail.timer'

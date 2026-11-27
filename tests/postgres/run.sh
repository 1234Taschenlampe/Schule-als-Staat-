#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
db=$(docker run --rm -d --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16@sha256:07abc3f43c9395b0bdbbab36bc25ddb0e8d83cd4fcafb5fb7d6abe14ff156dd8)
trap 'docker rm -f "$db" >/dev/null' EXIT
for attempt in {1..60}; do
  if docker exec "$db" pg_isready -U postgres -h 127.0.0.1 >/dev/null; then break; fi
  sleep 1
done
apply() {
  echo "Loading $1"
  docker exec -i "$db" psql -Xq -v ON_ERROR_STOP=1 -U postgres < "$1" >/dev/null
}
apply tests/postgres/bootstrap.sql
apply supabase/schema.sql
for file in supabase/v4_admin_bootstrap.sql \
  supabase/v4_voting.sql \
  supabase/v5_portal_posts.sql \
  supabase/v6_integrated_portal.sql \
  supabase/v6_1_data_safety.sql \
  supabase/v6_btree_gist_schema_hardening.sql \
  supabase/v7_disable_email_confirmation_admin_safety.sql \
  supabase/v8_self_service_signup_test.sql \
  supabase/v9_backfill_student_cards.sql \
  supabase/v10_school_qr_verification.sql \
  supabase/v10_school_qr_card_lock.sql \
  supabase/v11_student_onboarding.sql \
  supabase/v12_attendance_qr.sql \
  supabase/v13_school_roles.sql \
  supabase/v13_operator_capabilities.sql \
  supabase/v14_attendance_roster.sql \
  supabase/v14_work_hours_2027.sql \
  supabase/v15_permanent_student_card_qr.sql \
  supabase/v16_shop_inventory_tax_jobs.sql \
  supabase/v17_admin_qr_credit.sql \
  supabase/v18_school_competitions.sql \
  supabase/v19_custom_card_colors.sql \
  supabase/v20_guest_visa_onboarding.sql \
  supabase/v21_visa_email_and_checkout.sql \
  supabase/v22_visa_turnstile_enforcement.sql \
  supabase/v23_guest_visa_mail_quota.sql \
  supabase/v24_security_acl_hardening.sql \
  supabase/v25_postgres_default_acl_hardening.sql; do apply "$file"; done
apply supabase/visa_gmail_vault_dispatch_auth.sql
for file in supabase/migrations/*.sql; do
  # This operational reconciliation requires the school's encrypted identity register.
  [[ $file == */20261104_enforce_official_roster.sql ]] && continue
  apply "$file"
done
apply supabase/v26_onsite_visa.sql
apply supabase/v27_onsite_station_sessions.sql
apply tests/postgres/roles.sql
apply tests/postgres/onsite-visa.sql
# Two independent connections settle the same fixture payment concurrently.
for attempt in 1 2; do
  docker exec -i "$db" psql -Xq -v ON_ERROR_STOP=1 -U postgres < tests/postgres/settle.sql >/dev/null &
  if [[ $attempt == 1 ]]; then first=$!; else second=$!; fi
done
wait "$first"
wait "$second"
apply tests/postgres/payment-result.sql
apply tests/postgres/modules.sql

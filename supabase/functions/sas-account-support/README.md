# Account support deployment

Deploy the function with platform JWT verification disabled if the gateway uses
incompatible signing keys. The function verifies the Bearer token through Auth,
then the database rechecks the session and live administrator role. Never send a
service key to the browser. Deploy only after the account support migration is
applied and validated with synthetic accounts.

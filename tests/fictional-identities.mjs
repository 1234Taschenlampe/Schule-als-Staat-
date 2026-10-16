// Fictional addresses reserved for OFFLINE TEST FIXTURES ONLY.
// .test is a reserved TLD, not an email domain for sending login invitations.
// NEVER insert these into auth.users or give them real voting or cash privileges.
export const demoIdentities = Object.freeze([
  { email: "schueler-01@example.test", scenario: "verified voter", expectedRole: "member" },
  { email: "kasse-01@example.test", scenario: "cashier checkout", expectedRole: "cashier" },
  { email: "eltern-01@example.test", scenario: "unapproved parent voter", expectedRole: "member" }
]);

export const DEMO_NO_REAL_EMAILS = true;

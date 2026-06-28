import { buildTenantRecord } from "../platform/tenant-types";

// Test 1: defaults
const r1 = buildTenantRecord({ subdomain: "x", email: "x@y.no", customerType: "b2c" }, "admin");
console.assert(r1.plan === "trial", "Default plan should be trial, got " + r1.plan);
console.assert(r1.status === "trial", "Default status should be trial, got " + r1.status);
console.assert(r1.emailPreferences.lifecycle === true, "Default lifecycle should be true");
console.assert(r1.emailPreferences.transactional === true, "Transactional always true");
console.log("Test 1 (defaults): PASS");

// Test 2: explicit values
const r2 = buildTenantRecord({
  subdomain: "y", email: "y@z.no", customerType: "b2c",
  plan: "monthly", status: "active", lifecycleEmails: false,
}, "admin");
console.assert(r2.plan === "monthly", "Explicit plan, got " + r2.plan);
console.assert(r2.status === "active", "Explicit status, got " + r2.status);
console.assert(r2.emailPreferences.lifecycle === false, "Explicit lifecycle false");
console.log("Test 2 (explicit plan/status/lifecycle): PASS");

// Test 3: B2B + yearly + locked + lifecycle true
const r3 = buildTenantRecord({
  subdomain: "z", email: "z@w.no", customerType: "b2b", companyName: "Acme",
  plan: "yearly", status: "locked", lifecycleEmails: true,
}, "admin");
console.assert(r3.plan === "yearly");
console.assert(r3.status === "locked");
console.assert(r3.emailPreferences.lifecycle === true);
console.assert(r3.companyName === "Acme");
console.log("Test 3 (b2b + yearly + locked): PASS");

console.log("\nAll 3 tests passed.");

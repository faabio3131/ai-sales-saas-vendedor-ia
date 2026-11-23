# T13 — Recovery workers and Firestore security baseline

## Internal engineering (no fiscal issuance)
The existing payment reconciler's 5-minute service loop invokes:
- PSP payment and signed webhook recovery;
- **governance stale RESERVED quarantine**: after 30 minutes, an uncompleted
  receipt moves to REVIEW_REQUIRED via a Firestore transaction, without
  rerunning a tool, payment, or fulfillment action;
- **confirmed-payment fiscal-source recovery**: paginated scan of existing
  CONFIRMED payments replays only the idempotent
  SalesFiscalHandoffService.onConfirmed producer operation. It never
  issues NF-e/NFC-e/NFS-e and never marks a payment confirmed by itself.
  Missing quote, tampering, or missing original evidence goes to
  salesFiscalHandoffRecoveryIssues for human investigation.

Both scans use durable cursor rotation and must be monitored for failed,
skipped, quarantined, and confirmed counts. An unhealthy worker cycle must
not count as financial success.

## SEC-001 — Proposed Firestore rules (NOT deployed)
deploy/t13-server-only.firestore.rules is a complete deny-all **client
SDK** baseline; the Admin SDK bypasses client rules, so application IAM,
service-account privileges, and API tenancy protections remain mandatory.
Firebase authentication is not equivalent to permission to modify raw
financial/governance records.

**No rule deployment, active-rule export, or cloud project review has
been performed by this commit.** Before production, verify exact Firebase
project, compare export of the currently active rules with this baseline,
validate against intended direct Firebase client reads/writes, test
cross-tenant and anonymous attacks, and deploy only under an authorized
change with rollback. If front-end client reads are legitimately required,
they must be designed explicitly rather than silently opening sensitive
collections. Do not replace all production rules without impact review.

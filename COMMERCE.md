# Paddle commerce plan

Cueport uses Paddle as the launch merchant of record for the paid Mac app.
Paddle owns checkout, receipts, tax/VAT/GST handling, refunds, disputes, and
customer payment records. Cueport owns license keys, device activations,
offline behavior, update eligibility, and signed download links.

This split is intentional. Paddle gives Cue Labs a merchant-of-record checkout
for buyers in Canada, the United States, Germany, and other launch markets,
while Cueport keeps the product rules in its own database. The desktop app
should never call Paddle directly.

## Provider decision

Paddle is the right launch choice because Cueport needs merchant-of-record
coverage more than it needs a provider-hosted license server. Cue Labs is based
in Canada, and first customers are expected in Canada, the United States, and
Germany. Paddle handles the tax and receipt layer for those markets.

Polar remains a useful reference because it has built-in license-key and file
download benefits. It is not the launch choice because its payout flow uses
Stripe Connect Express. Easytools is not the launch choice because it is built
around the seller's own Stripe account and is not a merchant-of-record-first
solution for this use case.

## Product setup

Create one Paddle product for the launch license:

- Product: `Cueport Founding license`
- Price: `$49 USD`
- Billing cycle: one-time
- Quantity: one
- Description: `Includes perpetual use of this major version and one year of
  feature updates. Future licenses will be priced higher.`

Future prices should be separate Paddle prices rather than edits that obscure
which cohort a customer purchased from. Cueport records the Paddle price id on
each entitlement so founding licenses remain distinguishable.

## Customer-facing terms

The buy page and checkout copy must communicate these rules:

- One-time personal license.
- Activation on up to three Macs the buyer personally uses.
- Perpetual use of the purchased major version.
- One year of feature updates from purchase date.
- Maintenance patches remain available for the last eligible feature line.
- Future licenses will be priced higher.
- First-purchase refund policy is 14 days, subject to the published refund
  policy and legal requirements.

## Purchase flow

1. Customer clicks Buy license on `usecueport.com/buy/`.
2. Paddle Checkout completes the one-time purchase.
3. Paddle sends `transaction.completed` to the Cueport Worker.
4. The Worker verifies `Paddle-Signature`.
5. The Worker deduplicates the Paddle `event_id`.
6. The Worker creates a Cueport license key and entitlement.
7. The Worker sets `updates_until` to purchase date plus 12 months.
8. The Worker mints a signed DMG download link.
9. The Worker emails the license key and download link through the configured
   transactional email provider.

The first implementation can record the entitlement and return an operator
alert before customer email automation is enabled. It must not pretend email
delivery is complete until the email path is tested.

## Refund and chargeback flow

Paddle represents refunds and related changes as adjustments. Cueport should
listen for both `adjustment.created` and `adjustment.updated`.

Only approved refund or chargeback states should change the license. Pending
refunds must not revoke access. Rejected refunds must leave access unchanged.

When a refund or chargeback is approved, Cueport marks the license as refunded
or chargeback in its own entitlement database. That state blocks future signed
downloads, update access, renewals, and new activations. It does not promise to
stop an already activated fully offline Mac from running.

## License activation

Cueport generates its own license keys. Store only a hash of each license key in
D1. The plain key should only be shown or sent to the customer when issued.

Activation rules:

- A license may have up to three active machine activations.
- The desktop app sends a license key and machine id to `/license/activate`.
- The Worker hashes the key, checks entitlement status, and records the machine
  activation.
- The Worker returns a signed local license token for offline use.
- The desktop app stores the key and activation token in macOS Keychain.

Validation rules:

- The desktop app may call `/license/validate` when online.
- The app can keep running offline after a successful activation.
- Refunds, chargebacks, disabled licenses, and activation-limit failures block
  future online actions.

## Update entitlement

Cueport stores `updates_until` separately from Paddle purchase data. Feature
releases are available when `release_date <= updates_until`. Maintenance
patches remain available for the last eligible feature line.

Renewal products extend `updates_until` by 12 months from the later of the
current value or the renewal purchase date.

## Worker endpoints

The download Worker should become the commerce Worker for the launch flow:

- `GET /` serves signed DMG downloads from R2.
- `POST /webhooks/paddle` receives Paddle webhooks.
- `POST /license/activate` activates a license on a Mac.
- `POST /license/validate` validates a license and returns entitlement state.
- `POST /license/deactivate` can be added after launch for self-service device
  removal.

## Required bindings and secrets

Public repository config should keep only binding names and placeholders.
Operator-specific ids and secrets stay in Cloudflare dashboard variables,
secrets, or private deployment configuration.

- `CUEPORT_DOWNLOADS`: R2 bucket binding for DMGs.
- `DOWNLOAD_SECRET`: HMAC secret for signed download links.
- `CURRENT_DMG`: current DMG filename.
- `LICENSE_ENTITLEMENTS`: D1 database binding for licenses and events.
- `PADDLE_WEBHOOK_SECRET`: Paddle notification destination secret.
- `PADDLE_FOUNDING_PRICE_ID`: Paddle price id for the founding license.
- `RESEND_API_KEY`: transactional email secret, if email automation is enabled.
- `FROM_EMAIL`: sender address, if email automation is enabled.

## Minimal schema

The first D1 schema should include:

- `commerce_events`: Paddle event id, type, provider object id, raw JSON, and
  received timestamp for idempotency and audit.
- `license_entitlements`: license hash, Paddle customer id, Paddle transaction
  id, Paddle price id, email, status, updates_until, created timestamp, updated
  timestamp.
- `license_activations`: activation id, license hash, machine id hash, label,
  status, activated timestamp, last validated timestamp.
- `download_grants`: license hash, file name, signed link expiry, created
  timestamp, optional email-delivery state.

## Test plan

- Verify invalid webhook signatures are rejected.
- Verify repeated Paddle events do not create duplicate licenses.
- Verify a completed founding transaction creates one entitlement with a
  12-month update window.
- Verify approved refunds mark the license as refunded.
- Verify pending or rejected refunds do not revoke access.
- Verify activation accepts three machines and rejects the fourth.
- Verify offline token validation works without a network call.
- Verify signed download links expire and cannot be altered.

-- Cueport Lemon Squeezy entitlement schema.
--
-- Keep real database ids and operator-specific deployment config out of this
-- public repo. Bind this schema to the Worker from private deployment config
-- when licensing is enabled.

CREATE TABLE IF NOT EXISTS lemon_squeezy_webhook_events (
  event_key TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS license_entitlements (
  license_key_hash TEXT PRIMARY KEY,
  lemon_license_id TEXT,
  lemon_customer_id TEXT,
  lemon_order_id TEXT,
  email TEXT,
  status TEXT NOT NULL CHECK (
    status IN (
      'active',
      'refunded',
      'chargeback',
      'disabled'
    )
  ),
  updates_until TEXT,
  update_source TEXT NOT NULL CHECK (
    update_source IN (
      'paid',
      'comped_founder',
      'renewal'
    )
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS license_instances (
  instance_id TEXT PRIMARY KEY,
  license_key_hash TEXT NOT NULL REFERENCES license_entitlements(license_key_hash),
  instance_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'active',
      'deactivated'
    )
  ),
  activated_at INTEGER NOT NULL,
  last_validated_at INTEGER,
  deactivated_at INTEGER
);

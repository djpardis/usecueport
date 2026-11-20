CREATE TABLE IF NOT EXISTS commerce_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_object_id TEXT,
  payload_json TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS license_entitlements (
  entitlement_id TEXT PRIMARY KEY,
  license_key_hash TEXT UNIQUE,
  provider TEXT NOT NULL,
  provider_transaction_id TEXT UNIQUE,
  provider_customer_id TEXT,
  provider_price_id TEXT,
  email TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('pending_delivery', 'active', 'refunded', 'chargeback', 'disabled')
  ),
  updates_until TEXT,
  update_source TEXT NOT NULL CHECK (update_source IN ('paid', 'comped_founder', 'renewal')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS license_activations (
  activation_id TEXT PRIMARY KEY,
  license_key_hash TEXT NOT NULL,
  machine_id_hash TEXT NOT NULL,
  label TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'deactivated')),
  activated_at INTEGER NOT NULL,
  last_validated_at INTEGER NOT NULL,
  deactivated_at INTEGER,
  UNIQUE (license_key_hash, machine_id_hash)
);

CREATE TABLE IF NOT EXISTS download_grants (
  grant_id TEXT PRIMARY KEY,
  license_key_hash TEXT,
  provider_transaction_id TEXT,
  file_name TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  email_status TEXT NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed')),
  created_at INTEGER NOT NULL
);

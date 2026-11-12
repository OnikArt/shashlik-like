BEGIN;

CREATE TABLE IF NOT EXISTS order_idempotency (
  key text PRIMARY KEY CHECK (key ~ '^[A-Za-z0-9_-]{16,128}$'),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  order_id text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;

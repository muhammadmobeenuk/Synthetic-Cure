-- Whole-box allocation is the explicit initial fulfilment boundary.
CREATE UNIQUE INDEX IF NOT EXISTS allocations_one_current_order_per_box ON allocations(box_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

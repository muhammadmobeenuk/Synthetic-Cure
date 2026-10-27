-- Preserve previous records; at most one immutable cancellation per expectation.
CREATE UNIQUE INDEX inbound_single_cancellation ON inventory_events(org_id,entity_id) WHERE kind='inbound.expectation_cancelled';

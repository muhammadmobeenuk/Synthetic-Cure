ALTER TABLE allocations ADD COLUMN IF NOT EXISTS picked_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK(picked_quantity>=0 AND picked_quantity<=quantity);

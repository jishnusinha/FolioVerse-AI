-- Migration 0008: Enforce append-only cost entries at the database boundary
CREATE OR REPLACE FUNCTION app.prevent_cost_entry_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'cost_entries is append-only: updates and deletes are forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cost_entries_append_only ON app.cost_entries;
CREATE TRIGGER trg_cost_entries_append_only
BEFORE UPDATE OR DELETE ON app.cost_entries
FOR EACH ROW EXECUTE FUNCTION app.prevent_cost_entry_modification();

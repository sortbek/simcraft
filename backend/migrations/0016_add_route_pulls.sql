-- Level-agnostic route storage: a saved run is a dungeon + a pull assignment
-- (clone references per pull), so the SimC is regenerated at the chosen keystone
-- level on load. `mdt_string` becomes optional (empty for routes built on the
-- map); `dungeon_idx` + `pulls` (JSON) carry the route itself.
ALTER TABLE saved_routes ADD COLUMN dungeon_idx INTEGER;
ALTER TABLE saved_routes ADD COLUMN pulls TEXT;

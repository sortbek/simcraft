-- Edited routes carry a regenerated SimC fight definition (fight_style=DungeonRoute
-- + raid_events) so they can be re-simulated directly without re-deriving from the
-- MDT string. NULL for legacy bookmark rows that only stored the MDT string.
ALTER TABLE saved_routes ADD COLUMN simc TEXT;

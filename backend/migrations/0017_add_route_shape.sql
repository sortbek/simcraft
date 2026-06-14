-- Decorative route-shape thumbnail: normalized pull centroids in route order,
-- stored as JSON (`[{x,y,boss}, ...]`, x/y in [0,1] map-frame coords) so the
-- routes library can draw the real route shape on a card without decoding every
-- route on view. Computed at save time; backfilled lazily on first list. Null
-- for routes whose geometry isn't derivable (keystone.guru SimC / legacy footer).
ALTER TABLE saved_routes ADD COLUMN shape TEXT;

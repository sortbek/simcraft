pub mod addon_parser;
pub mod cancel;
pub mod compute;
pub mod db;
pub mod game_data;
pub mod gear_resolver;
pub mod item_db;
pub mod log_buffer;
pub mod models;
pub mod profileset_generator;
pub mod result_parser;
pub mod server;
pub mod simc_runner;
pub mod simc_string;
pub mod talent_normalize;
pub mod types;

#[cfg(test)]
pub(crate) mod test_support {
    use serde_json::{json, Value};
    use std::path::PathBuf;
    use std::sync::Once;

    static LOAD_GAME_DATA: Once = Once::new();

    /// Loads the compacted game-data fixtures used by tests that exercise
    /// item_db lookups (bonuses, gems, enchants). Idempotent across the test
    /// process — call from any test that needs real game data.
    ///
    /// Tests intentionally load from the **compacted** output rather than the
    /// raw Raidbots data, so that regressions in `scripts/compact-data.js` (e.g.
    /// stripping a field the runtime needs) surface as failing tests instead of
    /// silent production bugs.
    pub(crate) fn ensure_game_data_loaded() {
        LOAD_GAME_DATA.call_once(|| {
            let data_dir =
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/data-compacted");
            assert!(
                data_dir.join("bonuses.json").exists(),
                "missing test fixture {}/bonuses.json — run `node backend/scripts/compact-data.js \
                 backend/resources/data backend/resources/data-compacted` first",
                data_dir.display()
            );
            if let Err(e) = crate::item_db::load(&data_dir) {
                panic!("FATAL: failed to load game data: {}", e);
            }
        });
    }

    /// Builder for the JSON item shape used by gear-resolution, generator, and
    /// constraint tests. Set only the fields a test cares about; everything else
    /// defaults to the same baseline values the production code expects.
    pub(crate) struct TestItem {
        item_id: u64,
        slot: String,
        is_equipped: bool,
        origin: String,
        bonus_ids: Vec<u64>,
        enchant_id: u64,
        gem_id: u64,
        sockets: u64,
        simc_string: String,
        is_catalyst: bool,
    }

    impl TestItem {
        pub(crate) fn new(item_id: u64) -> Self {
            Self {
                item_id,
                slot: String::new(),
                is_equipped: false,
                origin: "bags".to_string(),
                bonus_ids: Vec::new(),
                enchant_id: 0,
                gem_id: 0,
                sockets: 0,
                simc_string: String::new(),
                is_catalyst: false,
            }
        }
        pub(crate) fn slot(mut self, slot: &str) -> Self {
            self.slot = slot.to_string();
            self
        }
        pub(crate) fn equipped(mut self) -> Self {
            self.is_equipped = true;
            self.origin = "equipped".to_string();
            self
        }
        pub(crate) fn origin(mut self, origin: &str) -> Self {
            self.origin = origin.to_string();
            self
        }
        pub(crate) fn bonus_ids(mut self, ids: Vec<u64>) -> Self {
            self.bonus_ids = ids;
            self
        }
        pub(crate) fn enchant_id(mut self, id: u64) -> Self {
            self.enchant_id = id;
            self
        }
        pub(crate) fn gem_id(mut self, id: u64) -> Self {
            self.gem_id = id;
            self
        }
        pub(crate) fn sockets(mut self, n: u64) -> Self {
            self.sockets = n;
            self
        }
        pub(crate) fn simc_string(mut self, s: &str) -> Self {
            self.simc_string = s.to_string();
            self
        }
        pub(crate) fn catalyst(mut self) -> Self {
            self.is_catalyst = true;
            self
        }
        pub(crate) fn build(self) -> Value {
            let mut v = json!({
                "item_id": self.item_id,
                "slot": self.slot,
                "is_equipped": self.is_equipped,
                "origin": self.origin,
                "bonus_ids": self.bonus_ids,
                "enchant_id": self.enchant_id,
                "gem_id": self.gem_id,
                "sockets": self.sockets,
                "simc_string": self.simc_string,
            });
            if self.is_catalyst {
                v["is_catalyst"] = json!(true);
            }
            v
        }
    }
}

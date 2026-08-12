//! Job-lifecycle concerns that sit below the HTTP layer: the persisted request
//! envelope, combo-metadata storage, and terminal-result finalization.
//!
//! These are shared by `server` (HTTP handlers) and `compute` (the cloud chunk
//! orchestrator). They live here rather than under `server` so `compute` never
//! has to depend on the HTTP layer — nothing in this module touches actix.

pub mod combo_metadata;
pub mod finalize;
pub mod request_json;

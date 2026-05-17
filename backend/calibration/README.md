# SimHammer Triage Calibration Harness

The calibration harness runs the Triage stage across a 3-axis grid of parameters
(batch size in bytes, simc iterations, retention cutoff multiplier) against a
captured Top Gear scenario, and records winner-loss rates vs a reference
full-precision baseline. The chosen defaults are then locked into
`backend/core/src/profileset_generator/triage.rs`.

## Process

### 1. Capture a reference scenario

In the running app (web or desktop):

1. Configure a Top Gear sim that produces a substantial combo count (target: >=1M,
   ideally ~5M). A real Mistweaver setup with many trinket/weapon/embellishment
   options is a good baseline.
2. Open browser devtools -> Network tab.
3. Click "Start sim".
4. Inspect the POST to `/api/top-gear/sim`. Copy the request body JSON.
5. Save to `backend/calibration/scenarios/topgear-<spec>-<combo-count>k.json`.

### 2. Produce the baseline result

Run the same scenario through the EAGER path at full precision to get the
reference winners. Two ways:

- **Live app:** Temporarily set `TRIAGE_THRESHOLD` higher than the scenario's
  combo count in [`triage.rs`](../core/src/profileset_generator/triage.rs), then
  start the sim with `iterations=50000` and `target_error=0.05`. After it
  completes, export the result JSON.
- **Offline:** Run the eager generator + simc directly.

Save the top 10 (and ideally all) ranked profilesets to
`backend/calibration/scenarios/topgear-<spec>-<combo-count>k.baseline.json`:

```json
{
  "scenario": "topgear-mistweaver-5m",
  "iterations": 50000,
  "target_error": 0.05,
  "total_profilesets": 5000000,
  "top_10": [
    { "combo_name": "Combo 12345", "mean": 1234567.8 },
    ...
  ]
}
```

### 3. Run the grid

```powershell
cd backend
cargo run --release -p simhammer-calibration -- `
  calibration/scenarios/topgear-mistweaver-5m.json `
  --baseline calibration/scenarios/topgear-mistweaver-5m.baseline.json `
  --simc-bin path/to/simc.exe
```

This runs Triage 45 times (5 batch sizes x 3 iterations x 3 cutoffs) and writes
`topgear-mistweaver-5m.calibration.json`.

### 4. Lock the defaults

Inspect the grid results. Pick the grid point that **minimizes
end_to_end_seconds subject to winner_loss_count = 0** on the baseline top-10.

Edit [`triage.rs`](../core/src/profileset_generator/triage.rs) and update
the module-level `pub const`s to match the chosen grid point. Add a comment:

```rust
// Locked by calibration on YYYY-MM-DD against scenarios/topgear-<spec>-Nk.json.
// See scenarios/topgear-<spec>-Nk.calibration.json for the grid results.
// Winner-loss = 0 on baseline top-10.
```

### 5. Verify

Re-run the captured scenario via the streaming path with the new defaults.
Confirm the result's top-10 matches the baseline's top-10.

## Notes

- The scaffold's grid loop currently has a TODO where `run_triage_with_constants`
  should be wired in. To complete the wiring, extract `build_iterator_config`
  from `top_gear_handlers.rs::start_streaming_top_gear_job` into a `pub` function
  (e.g., `pub fn build_iterator_config_from_request(...)`) so the harness can
  call it without going through actix.
- Defer the wiring to when calibration is actually being run -- the harness
  structure is in place; the inner loop is mechanical to fill in.
- `TriageConstants` in `triage.rs` exposes all tunable parameters. The three
  grid axes are `target_batch_input_bytes`, `triage_iterations`, and
  `triage_cutoff_multiplier`; the rest stay at `Default` during grid search.

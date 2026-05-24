# SimHammer Triage Calibration Harness

The calibration harness runs the Triage stage across a 3-axis grid of parameters
(profilesets per SimC invocation, simc iterations, retention cutoff multiplier) against a
captured Top Gear scenario, and records winner-loss rates vs a reference
full-precision baseline. The chosen defaults are then locked into
`backend/core/src/profileset_generator/triage.rs`.

This harness measures Triage only. Intermediate staged evaluation uses the
separate `STAGED_BATCH_PROFILESETS` setting and should be measured with
end-to-end application runs after choosing Triage defaults. The final
precision stage is unbatched, so neither batch knob improves pause latency
while a job is in Final.

## Process

### 1. Capture a reference scenario

The harness reads a `NormalizedRequest` envelope — the same JSON shape stored
in `jobs.request_json` for streamed-mode jobs. Capturing it:

1. Configure and start a Top Gear sim with a substantial combo count (target:
   >=1M). A real Mistweaver setup with many trinket/weapon/embellishment
   options is a good baseline.
2. Let the job hit at least the streaming path (≥`TRIAGE_THRESHOLD` combos).
   Pausing it immediately after start is fine — we only need the persisted
   `request_json`.
3. Pull the envelope out of SQLite (desktop or web):

   ```sql
   SELECT request_json FROM jobs WHERE id = '<your-job-id>';
   ```
4. Save the JSON to
   `backend/calibration/scenarios/topgear-<spec>-<combo-count>k.json`.

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
  --simc-bin path/to/simc.exe `
  --batch-profilesets 100,250,500,1000
```

This runs Triage 36 times (4 batch sizes x 3 iterations x 3 cutoffs) and writes
`topgear-mistweaver-5m.calibration.json`.

Each batch-size value pins both Triage min/max profilesets for a direct
comparison; the initial 100-profile probe remains unchanged. Key result
fields are:

- `end_to_end_seconds`: total Triage time for the grid point.
- `average_batch_seconds`: mean interval at which Triage can observe a pause request; actual worst case is the longest individual batch.
- `profilesets_per_second` and `seconds_per_1000_profilesets`: overhead comparison between batch sizes.
- `total_batches` and `triage_survivors`: invocation count and downstream-work impact.
- `winner_loss_count`: retained winner correctness against the supplied baseline.

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

- The inner loop is wired through
  [`build_iterator_from_request_json`](../core/src/profileset_generator/iterator_from_request.rs)
  (also used by the resume path), so the harness reads exactly the same
  envelope shape stored in `jobs.request_json`.
- Each grid point runs against a fresh in-memory SQLite DB
  (`sqlite::memory:`) so combo_metadata / combo_dedup / triage_batches don't
  leak between points.
- `TriageConstants` in `triage.rs` exposes all tunable parameters. The three
  grid axes are pinned `min_batch_profilesets == max_batch_profilesets`,
  `triage_iterations`, and
  `triage_cutoff_multiplier`; the rest stay at `Default` during grid search.
- The captured request must include `payload.estimate`; Triage uses it for
  survivor budgeting, so substituting an arbitrary estimate invalidates the
  comparison.
- **Winner-loss matching limitation:** combos are matched by name across the
  baseline and the survivors. The streaming iterator assigns names in its own
  order, so identical *content* may appear under different names across runs
  (eager-baseline "Combo 12345" likely refers to different gear than
  streaming "Combo 12345"). For true content-based recall, export the
  baseline's full `profileset_simc` per top combo and switch the matching to
  content hashing — see [`identity_key.rs`](../core/src/profileset_generator/identity_key.rs)
  for the effective-form hash used by the iterator. Filed as a follow-up.

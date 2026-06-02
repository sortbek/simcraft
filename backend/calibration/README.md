# SimHammer Local Top Gear Calibration / Benchmark Harness

The calibration harness benchmarks local Top Gear pruning from either captured
`jobs.request_json` scenarios or raw SimC addon fixtures. It has two modes:

- `triage`: historical triage grid over profilesets per SimC invocation,
  triage iterations, and retention cutoff multiplier.
- `pipeline`: triage plus staged local execution under named stage-bracket
  strategies, so we can compare production against simpler brackets.

The priority is local/self-run SimC behavior. Cloud/Simmit can inform the shape,
but this bench exists to answer whether SimHammer's own triage/staging pipeline
is correct, fast, and worth its complexity.

## Canonical Scenarios

Keep at least two captured Top Gear scenarios:

1. **High-spread gear scenario**
   - Many upgrades/downgrades: item-level differences, trinkets, weapons,
     catalysts, crafted/embellished gear.
   - Expected: early stages prune aggressively and multi-stage should win.

2. **Low-spread gem/enchant scenario**
   - Same gear, many gem/enchant permutations with tiny DPS deltas.
   - Expected: pruning is slow, multiple stages may add overhead, and simpler
     schedules may win.

Suggested names:

```text
backend/calibration/scenarios/topgear-high-spread-<spec>-<count>.json
backend/calibration/scenarios/topgear-low-spread-gems-<spec>-<count>.json
```

## Capture A Scenario

The harness reads a `NormalizedRequest` envelope, the same JSON shape stored in
`jobs.request_json` for streamed-mode jobs.

1. Configure and start a Top Gear sim with a substantial combo count.
2. Let the job reach the streaming path. Pausing immediately after start is fine.
3. Pull the envelope from SQLite:

```sql
SELECT request_json FROM jobs WHERE id = '<job-id>';
```

4. Save it under `backend/calibration/scenarios/`.

The captured request must include `payload.estimate`; triage uses it for
survivor budgeting.

## Raw Addon Fixtures

For combination-builder coverage, prefer a raw fixture. This runs the addon
input through the same parser, resolver, item selection, and generator path
before benchmarking the triage/pipeline stages.

```json
{
  "name": "topgear-high-spread-bm-hunter-9k",
  "simc_input": "<paste SimC addon export here>",
  "copy_enchants": true,
  "select_all_alternative_slots": [
    "neck",
    "shoulder",
    "back",
    "chest",
    "wrist",
    "waist",
    "legs"
  ],
  "selected_alternatives": {
    "feet": [
      { "item_id": 258582 }
    ]
  },
  "options": {
    "fight_style": "Patchwerk",
    "target_error": 0.05,
    "iterations": 1000,
    "desired_targets": 1,
    "max_time": 300,
    "threads": 0,
    "single_actor_batch": true
  }
}
```

Use `"simc_input_path": "profile.simc"` instead of `simc_input` to keep large
addon exports in a separate file next to the fixture JSON.

`selected_alternatives` entries may be a UID string, or an object with
`item_id`, `name`, `uid`, and/or `bonus_ids`. All fields in an object must
match. The default `--data-dir` is `resources/data-compacted` when running from
`backend`; pass another path if needed.

## Baselines

For correctness comparisons, save a baseline JSON next to each scenario:

```json
{
  "scenario": "topgear-high-spread-monk-250k",
  "iterations": 50000,
  "target_error": 0.05,
  "total_profilesets": 250000,
  "top_10": [
    {
      "combo_name": "Combo 12345",
      "combo_key": "optional-content-key",
      "mean": 1234567.8
    }
  ]
}
```

If baseline entries include `combo_key` or `identity_key`, recall is matched by
content key. Otherwise it falls back to `combo_name`, which is weaker because
eager and streaming paths may assign different names to identical effective
gear.

## Run The Triage Grid

```powershell
cd backend
cargo run --release -p simhammer-calibration -- `
  calibration/scenarios/topgear-high-spread-monk-250k.json `
  --mode triage `
  --baseline calibration/scenarios/topgear-high-spread-monk-250k.baseline.json `
  --runs 3 `
  --simc-bin path/to/simc.exe `
  --batch-profilesets 100,250,500,1000
```

This runs 36 grid points per scenario/run by default:

```text
4 batch sizes x 3 triage iteration values x 3 cutoff multipliers
```

Useful fields:

- `total_seconds`
- `average_triage_batch_seconds`
- `profilesets_per_second`
- `triage_survivors`
- `total_batches`
- `total_candidates`
- `total_accepted`
- `top_recall_loss_count`

## Run The Pipeline Bench

```powershell
cd backend
cargo run --release -p simhammer-calibration -- `
  calibration/scenarios/topgear-high-spread-monk-250k.json `
  calibration/scenarios/topgear-low-spread-gems-monk-250k.json `
  --mode pipeline `
  --runs 3 `
  --baseline `
    calibration/scenarios/topgear-high-spread-monk-250k.baseline.json `
    calibration/scenarios/topgear-low-spread-gems-monk-250k.baseline.json `
  --simc-bin path/to/simc.exe `
  --batch-profilesets 250,1000 `
  --strategies current,simmit3,broad-final,refine-final `
  --out calibration/scenarios/local-pipeline-benchmark.json
```

Built-in strategies:

- `current`: production staged schedule (`1.0 -> 0.5 -> final`).
- `simmit3`: historical alias for the same Simmit-style ladder.
- `broad-final`: `1.0 -> final`.
- `refine-final`: `0.5 -> final`.

Custom brackets use `+` or `/` between target errors because commas are already
used by the CLI list parser:

```powershell
--strategies current,custom=1.0+0.5+0.1
```

Pipeline result fields:

- `total_seconds`, `triage_seconds`, `staged_seconds`
- `triage_survivors`
- `stage_summaries`
- `final_profilesets`
- `top_recall_loss_count`: missing baseline top entries after triage
- `dps_regret`: `baseline_best_mean - final_best_mean`, when baseline includes
  a `mean`

## Reading Results

For local-first tuning, prefer the simplest strategy that satisfies:

```text
top_recall_loss_count = 0
dps_regret = 0 or acceptably tiny
stable performance across repeated runs
good behavior on both high-spread and low-spread scenarios
```

The high-spread scenario should reward staging. The low-spread scenario is the
guardrail against over-staging.

## Run The Decision Benchmark

Use this when changing production pruning/staging defaults. It generates a
broad all-combo oracle first, reruns the oracle's top candidates at high
precision, then runs candidate pipeline schedules against that baseline by
stable combo identity key.

```powershell
cd backend
cargo run --release -p simhammer-calibration -- `
  calibration/scenarios/topgear-high-spread-sortbek-bm-9k.raw.json `
  calibration/scenarios/topgear-cutting-edge-spread-sortbek-bm-gems.raw.json `
  --mode decision `
  --runs 3 `
  --simc-bin resources/simc/nightly-2026-05-31-13cd910/simc.exe `
  --batch-profilesets 1000 `
  --strategies current,broad-final,refine-final `
  --baseline-prefilter-target-error 1.0 `
  --baseline-candidate-count 250 `
  --baseline-target-error 0.05 `
  --baseline-iterations 50000 `
  --out calibration/scenarios/sortbek-local-decision-benchmark.json
```

Decision fields to trust:

- `final_winner_retained`: whether the oracle winner reached the precise
  Final stage.
- `final_top_recall_loss_count`: how many oracle top-10 identity keys missed
  the precise Final stage.
- `dps_regret`: oracle best mean minus candidate final best mean.
- `total_seconds`: end-to-end local runtime.

Promote a strategy only when both scenarios have `final_winner_retained=true`,
`final_top_recall_loss_count=0`, negligible `dps_regret`, and repeated runtime
is materially better or simpler than the alternative.

If the oracle still runs too long, lower `--baseline-candidate-count` to 100.
If a result is borderline, raise it to 500 for a confidence pass.

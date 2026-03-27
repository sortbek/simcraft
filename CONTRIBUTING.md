# Contributing to SimHammer

## Pull Request Guidelines

- **One concern per PR.** Don't mix features, bug fixes, and refactors in a single PR.
- **No formatting-only changes in functional PRs.** If code needs reformatting, do it in a separate commit or PR. This keeps diffs reviewable.
- **Keep PRs small.** Smaller PRs get reviewed faster and are less likely to introduce bugs.

## Code Style

### Frontend (TypeScript / React)

Formatting is enforced by [Prettier](https://prettier.io/) with the config in `.prettierrc`.

```bash
cd frontend

# Check formatting
npx prettier --check "src/**/*.{ts,tsx,css}"

# Auto-fix formatting
npx prettier --write "src/**/*.{ts,tsx,css}"
```

### Backend (Rust)

Formatting is enforced by `rustfmt`. Linting is done with `clippy`.

```bash
cd backend

# Check formatting
cargo fmt --all -- --check

# Auto-fix formatting
cargo fmt --all

# Lint
cargo clippy --all-targets --all-features -- -D warnings
```

## CI Checks

All PRs to `master` and `dev` run automated checks:

- **Prettier** — Frontend formatting must pass
- **ESLint** — Frontend linting via `next lint`
- **rustfmt** — Backend formatting must pass
- **Clippy** — Backend linting must pass

Fix any failures locally before pushing.

## Development Setup

See the [README](README.md) for full setup instructions.

# Hanover Catalog & Schedule Visualizer

A static Vue 3 SPA that browses Hanover College's academic programs, their courses,
requirements, and a synthetic sample schedule. Data is scraped from
[catalog.hanover.edu](https://catalog.hanover.edu) and shipped as static JSON.

Live site: <https://skiadas.github.io/catalog-vis/>

## Quick start

The app is a zero-build static site (Vue loaded from CDN). Serve the repo root:

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

## Data pipeline

| Step | Script | Output |
|------|--------|--------|
| Scrape catalog | `scrape_catalog.py` | `majors.json` (54 programs, 1144 courses) |
| Codify requirements (LLM-assisted) | `codify_requirements.py` per `REQUIREMENTS_SCHEMA.md` | `requirements_parsed.json` |
| Generate synthetic schedule | `generate_schedule.py` (seed 42, deterministic) | `sample-schedule.csv` |

See `AGENTS.md` for the full architecture and reprocessing workflow.

## Development

Requirements: Node ≥ 20 (tooling only; not used by the app) and Python 3.

```sh
npm install          # dev tooling (prettier, eslint)
npm test             # unit tests for lib/schedule.js
npm run lint         # eslint
npm run format       # prettier --write
```

Python tooling:

```sh
python3 -m pip install -r requirements.txt
python3 test/test_data.py          # data invariants + schedule determinism
```

Python formatting (Black, preserves single quotes):

```sh
python3 -m black scrape_catalog.py generate_schedule.py codify_requirements.py
```

## How it's deployed

GitHub Actions runs lint/format/tests on every push (`.github/workflows/ci.yml`).
The site is published to GitHub Pages from the `main` branch (repo root).
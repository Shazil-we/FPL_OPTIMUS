# FPL-Optimus

**An Automated Fantasy Premier League Squad Selector, Transfer Optimizer, and Live Tracking Dashboard using Machine Learning and Local Search Optimization**

---

## Highlights

- **Custom Combinatorial Local Search (Zero Black-Box Solvers):** Pure-Python implementations of `SimulatedAnnealingAgent` (geometric cooling + 80% 1-swap / 20% cross-position 2-swap moves), `HillClimbingAgent`, `GreedyValueAgent`, and `RandomSquadAgent`, plus a multi-transfer `TransferOptimizer` supporting 1–5 banked free transfers and $-4\text{ pt}$ hit exploration.
- **DefCon-Aware Tabular ML Engine (`scikit-learn`):** Decouples expected points into $\text{xP}_{\text{base}}$ (`HistGradientBoostingRegressor` vs `RidgeCV` vs `Rolling3Avg`) and calibrated $P(\text{DefCon Hit}_p)$ (`HistGradientBoostingClassifier`, $\text{ROC-AUC} = 0.874$) so the $+2\text{ pt}$ CBIT/CBIRT bonus is never double-counted.
- **Probabilistic Tactical Archetypes (GMM + BIC):** Full-covariance Gaussian Mixture Models per position with automated BIC component selection (`High-CBIT Central Defender`, `DefCon Floor Anchor (CDM)`, `Attacking Wing-Back`, `Premium Captain`, `Budget Bench Filler`).
- **Dual-Mode Operation:**
  1. **100% Offline Reproducible CLI (`src/experiments.py --seed 2026`):** Socket-blocked evaluator that generates all CSV tables in `outputs/results/` and publication-ready charts in `outputs/figures/`.
  2. **Live Full-Stack Web App (`src/api/` + `frontend/`):** Async FastAPI backend (`httpx` with TTL + disk snapshot cache) and Next.js + Tailwind CSS tactical dashboard.

---

## Repository Structure

```text
fpl_optimus/
├── README.md                 # Architecture details, setup instructions, and CLI commands
├── requirements.txt          # Backend dependencies (fastapi, uvicorn, scikit-learn, pandas, numpy, httpx)
├── Dockerfile.backend        # Production container for FastAPI + pre-trained models
├── docker-compose.yml        # Local multi-container orchestration (backend :8000, frontend :3000)
├── render.yaml               # Cloud deployment blueprint for Render
├── docs/
│   ├── proposal.md           # Architectural blueprint & problem formulation
│   └── report.md             # Complete offline empirical evaluation & benchmark tables
├── scripts/
│   └── download_data.py      # One-time downloader for Vaastav's 2022-23..2025-26 CSVs
├── data/
│   ├── raw/                  # Historical multi-season CSVs for offline reproducibility
│   ├── processed/            # Engineered rolling & DefCon features + OOS predictions
│   └── cache/                # Cached live FPL API JSON snapshots
├── models/
│   └── bundle.joblib         # Pre-trained production ModelBundle (HGB + DefCon + GMM)
├── src/
│   ├── data_loader.py        # HistoricalDataLoader, FeatureEngineer, CacheStore, FPLApiClient
│   ├── models.py             # HistGBXPModel, RidgeXPModel, DefConClassifier, ArchetypeClusterer
│   ├── squad.py              # PlayerPool, SquadState, SquadEvaluator, exact XI solver
│   ├── agents.py             # BaseSelectorAgent, SimulatedAnnealing, HillClimbing, Greedy, Random
│   ├── environment.py        # TransferOptimizer (1..5 FT + hits) & SeasonBacktester
│   ├── experiments.py        # Seeded offline CLI reproducing all charts & tables
│   ├── train_live.py         # CLI trainer for models/bundle.joblib
│   └── api/
│       ├── main.py           # FastAPI app & CORS setup
│       └── routes.py         # Async REST endpoints (/api/bootstrap, /api/manager, /api/optimize, ...)
├── tests/
│   └── test_fpl_optimus.py   # Pytest suite (constraints, solver, agents, transfers, mocked httpx, API)
├── frontend/                 # Next.js App Router + Tailwind CSS tactical dashboard
└── outputs/
    ├── figures/              # Matplotlib charts exported by experiments.py
    └── results/              # Benchmark CSV & JSON summary tables
```

---

## Quickstart & CLI Commands

### 1. Environment Setup
```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
```

### 2. Download Historical Data (One-Time)
```powershell
.\.venv\Scripts\python scripts\download_data.py
```

### 3. Run the Offline Experiment Suite (100% Network-Isolated)
```powershell
.\.venv\Scripts\python src\experiments.py --seed 2026
```
- Fast smoke mode: `.\.venv\Scripts\python src\experiments.py --seed 2026 --quick`
- Exports `ml_metrics.csv`, `defcon_classifier_metrics.csv`, `gmm_summary.csv`, `gmm_archetypes.csv`, `optimizer_summary.csv`, `backtest_summary.csv`, `benchmarks.json` to `outputs/results/` and 9 PNG figures to `outputs/figures/`.

### 4. Train / Refresh Live Production Models
```powershell
.\.venv\Scripts\python src\train_live.py --seed 2026
```

### 5. Run Tests
```powershell
.\.venv\Scripts\python -m pytest -v
```

### 6. Start the Live Web Application
**Backend (FastAPI on `http://localhost:8000`):**
```powershell
.\.venv\Scripts\uvicorn src.api.main:app --reload --port 8000
```
**Frontend (Next.js on `http://localhost:3000`):**
```powershell
cd frontend
npm install
npm run dev
```
*(Or run both with `docker compose up --build`.)*

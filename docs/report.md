# Technical Report — FPL-Optimus

**Title:** *FPL-Optimus: An Automated Fantasy Premier League Squad Selector, Transfer Optimizer, and Live Tracking Dashboard using Machine Learning and Local Search Optimization*

**Seed:** `2026` (`python src/experiments.py --seed 2026`)
**Dataset:** Vaastav Anand Historical FPL Dataset (`2022-23` through `2025-26`, $113,260$ player-fixture records, $83$ engineered columns).

---

## 1. Methodology & Feature Engineering

### 1.1 Leakage-Free Temporal Telemetry (`src/data_loader.py`)
Every historical match row is standardized to a common `(player_key, season, gw, fixture)` schema. Rolling 3- and 5-match player form (`minutes`, `total_points`, `xg`, `xa`, `xgc`, `bps`, `bonus`, `starts`, `clean_sheets`, `cbit`, `cbirt`, `defcon`, `defcon_hit`), per-90 rates over the 5-match window, expanding season points-per-match (`ppm_season`), and rolling team expected-goal share (`team_xg_share`, territory/possession proxy) are shifted by 1 match (`shift(1)`) within each player/team history before joining with upcoming fixture context (`fdr`, `was_home`, venue-aware own/opponent attack & defence strength).

### 1.2 Decoupled DefCon Point Formulation (`src/models.py`)
In the 2025–26 FPL scoring system, Defenders earn $+2$ points for $\ge 10$ CBIT actions (`clearances_blocks_interceptions + tackles`) and Midfielders/Forwards earn $+2$ points for $\ge 12$ CBIRT actions (`CBIT + recoveries`). To avoid double-counting this discrete bonus inside expected points regression:
- **Base Expected Points ($\text{xP}_{\text{base}}$):** Regressors are trained on $\text{target\_base} = \text{total\_points} - \text{defcon\_points}$.
- **DefCon Hit Probability ($P(\text{DefCon Hit}_p)$):** An isotonic-calibrated `HistGradientBoostingClassifier` predicts the probability that an outfield player reaches their positional threshold.
- **Combined Player Value:** $\text{xP}(p) = \text{xP}_{\text{base}}(p) + 2 \cdot P(\text{DefCon Hit}_p)$.

---

## 2. Machine Learning Evaluation (`2025-26` Out-of-Sample)

Models are evaluated via expanding-window chronological cross-validation across all 38 gameweeks of `2025-26` in 5-gameweek blocks (training strictly on `2022-23`..`2024-25` plus earlier `2025-26` gameweeks).

### 2.1 Expected Points Regression (`outputs/results/ml_metrics.csv`)

| Model | Evaluation Subset | RMSE (↓) | MAE (↓) | $R^2$ (↑) |
|---|---|---:|---:|---:|
| **HistGradientBoosting** | All fixtures ($N = 29,747$) | **1.8497** | **0.9339** | **0.3047** |
| **RidgeCV** | All fixtures ($N = 29,747$) | 1.8546 | 0.9841 | 0.3010 |
| **Rolling-3 Average** | All fixtures ($N = 29,747$) | 2.0791 | 0.9985 | 0.1215 |
| **HistGradientBoosting** | Active (`minutes > 0`) | **2.8137** | **1.8635** | **0.0241** |
| **RidgeCV** | Active (`minutes > 0`) | 2.8183 | 1.8646 | 0.0208 |
| **Rolling-3 Average** | Active (`minutes > 0`) | 3.1768 | 2.1801 | -0.2442 |

**Findings:** `HistGradientBoostingRegressor` achieves the lowest RMSE (`1.8497`) and MAE (`0.9339`) and highest $R^2$ (`0.3047`) across all fixtures, outperforming the `RidgeCV` linear baseline on every metric and improving RMSE by **11.0%** over the naive 3-gameweek rolling average (`2.0791`).

### 2.2 DefCon Probability Classifier (`outputs/results/defcon_classifier_metrics.csv`)

| Metric | Value |
|---|---:|
| Out-of-Sample Outfield Appearances ($N$) | $26,320$ |
| Empirical Base Hit Rate | $5.38\%$ |
| **ROC-AUC (↑)** | **0.8739** |
| **Brier Score (↓)** | **0.0440** |

---

## 3. Tactical Archetype Discovery (GMM + BIC)

Full-covariance Gaussian Mixture Models (`ArchetypeClusterer`) were fitted per position on `2025-26` players with $\ge 450$ minutes, sweeping $k \in [3, 9]$ ($k \in [2, 4]$ for GK) and selecting $k^*$ minimizing BIC (`outputs/results/gmm_summary.csv`):

| Position | Optimal $k^*$ (min BIC) | BIC Sweep | Discovered Tactical Archetypes |
|---|---:|---|---|
| **GK** | $2$ | $\{2: 332.5\}$ | *Shot-Stopper*, *Premium Keeper* |
| **DEF** | $3$ | $\{3: 2637.4, 4: 2705.0, \dots, 9: 3303.1\}$ | *Premium Defender*, *High-CBIT Central Defender*, *Attacking Wing-Back* |
| **MID** | $3$ | $\{3: 2954.9, 4: 3016.8, \dots, 9: 3645.5\}$ | *Premium Captain*, *DefCon Floor Anchor (CDM)*, *Budget Bench Filler* |
| **FWD** | $3$ | $\{3: 847.7, 4: 924.5\}$ | *Budget Bench Filler*, *Premium Captain*, *Pressing Forward* |

Notable soft-clustered examples include **Declan Rice**, **Rodri**, and **Dominik Szoboszlai** in *DefCon Floor Anchor (CDM)* ($P(\text{DefCon Anchor}) > 0.95$), **Marc Cucurella** and **Jurriën Timber** in *Attacking Wing-Back*, and **Mohamed Salah**, **Cole Palmer**, and **Bukayo Saka** in *Premium Captain*.

---

## 4. Combinatorial Local Search Benchmark (`GW20`, 30 Seeds)

All search agents were benchmarked on `2025-26` Gameweek 20 out-of-sample predictions across **30 independent seeds** under an identical budget of **5,000 fitness evaluations** per run, starting from the exact same random valid squad per seed (`outputs/results/optimizer_summary.csv`):

| Agent | Mean Fitness $F(S)$ (↑) | Std Dev (↓) | Best Fitness | Worst Fitness | Mean Runtime (s) | Mean Evaluations |
|---|---:|---:|---:|---:|---:|---:|
| **SimulatedAnnealing** | **68.71** | **0.40** | **69.35** | **67.79** | 2.72s | 5,000 |
| **HillClimbing (with restarts)** | 65.88 | 1.20 | 68.02 | 63.59 | 1.79s | 5,000 |
| **GreedyValue** | 64.10 | 0.00 | 64.10 | 64.10 | 0.001s | 1 |
| **HillClimbing (no restart)** | 62.78 | 2.33 | 66.47 | 56.54 | 0.36s | 939 |
| **RandomSquad** | 44.07 | 1.88 | 49.35 | 41.46 | 8.73s | 5,000 |

### Key Optimization Insights
1. **Breaking the £0.0m Bank & Local Optima Trap:** Single-trajectory `HillClimbing (no restart)` gets trapped after an average of only $939$ evaluations at a mean fitness of `62.78` (worse than the single-shot `Greedy` heuristic at `64.10`) because 1-for-1 position swaps cannot shift budget across positions once the bank is near £0.0m.
2. **Value of 2-Swap Moves + Metropolis Acceptance:** `SimulatedAnnealing` combines a 20% cross-position 2-swap move (simultaneous upgrade + downgrade) with geometric cooling ($T_0 = 10.0, \alpha = 0.995$), outperforming `HillClimbing (with restarts)` by **+2.83 expected points per gameweek** (`68.71` vs `65.88`) with $3\times$ lower variance (`0.40` vs `1.20`). Even the worst of the 30 SA runs (`67.79`) beats 28 of the 30 Hill Climbing runs.

---

## 5. Full-Season Backtest (`2025-26`, GW1–GW38)

Each agent constructs an initial £100.0m squad at GW1 using only pre-season/prior-season history, and subsequently applies the exact 1-free-transfer `TransferOptimizer` before each gameweek (`GW2`–`GW38`) using strictly out-of-sample predictions. Realised points are tallied with captaincy doubling, vice-captain failover, and legal formation auto-substitutions (`outputs/results/backtest_summary.csv`):

| Agent (GW1 Builder + Weekly 1-FT Optimizer) | Total Season Points (↑) | Mean GW Points | Transfers Made | Best Single GW |
|---|---:|---:|---:|---:|
| **SimulatedAnnealing** | **2,231** | **58.71** | 37 | 89 |
| **HillClimbing** | 2,171 | 57.13 | 37 | 86 |
| **Random ( + Weekly Optimal 1-FT)** | 2,135 | 56.18 | 37 | 94 |
| **GreedyValue** | 2,084 | 54.84 | 37 | 101 |

**Conclusion:** Starting from a balanced, budget-efficient `SimulatedAnnealing` roster and applying weekly DefCon-aware transfer optimization yields **2,231 realised FPL points** across the 38-gameweek season (**+60 pts** over Hill Climbing and **+147 pts** over the Greedy value baseline, which hoards £14.2m unspent bank due to ratio-only selection).

---

## 6. Generated Figures (`outputs/figures/`)
- `outputs/figures/ml_rmse_per_gw.png` — Out-of-sample RMSE across all 38 gameweeks of `2025-26`.
- `outputs/figures/ml_calibration.png` — 20-bin quantile calibration curve for `HistGradientBoosting`, `RidgeCV`, and `Rolling-3`.
- `outputs/figures/defcon_calibration.png` — Reliability diagram for calibrated $P(\text{DefCon Hit})$.
- `outputs/figures/gmm_bic.png` — Per-position BIC model selection curves ($k \in [2, 9]$).
- `outputs/figures/gmm_archetypes_scatter.png` — 2D tactical scatter plot of DefCon hit rate vs. $\text{xG}+\text{xA}$ per 90, sized by price.
- `outputs/figures/optimizer_convergence.png` — Mean $\pm 1\sigma$ fitness convergence over 5,000 evaluations (30 seeds).
- `outputs/figures/sa_trace_temperature.png` — Dual-axis Simulated Annealing current/best fitness trace and geometric cooling schedule.
- `outputs/figures/optimizer_boxplot.png` — Final fitness distribution across all 5 optimizer variants.
- `outputs/figures/backtest_cumulative.png` — 38-gameweek cumulative realised points trajectories.

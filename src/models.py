"""Machine-learning engine for FPL-Optimus.

Contents
--------
* Expected-points regressors sharing one interface (`BaseXPModel`):
  `HistGBXPModel` (primary), `RidgeXPModel` (linear comparison) and
  `RollingAverageXPModel` (rolling-3 baseline). All predict the **DefCon-free**
  per-fixture target ``target_base = total_points - defcon_points``.
* `DefConClassifier`: calibrated gradient-boosting classifier for P(DefCon hit) per
  fixture, trained on seasons where DefCon exists (2025-26+). GK -> 0.
* `ArchetypeClusterer`: per-position Gaussian Mixture Models with full covariance and
  BIC-selected component count, rule-based archetype naming and soft posteriors.
* `chronological_evaluation`: expanding-window, GW-blocked evaluation on a held-out
  season (train strictly on earlier data) reporting RMSE / MAE / R^2.
* `ModelBundle`: persistence of the production models (joblib).
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import RidgeCV
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.mixture import GaussianMixture
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import StandardScaler

from src.data_loader import DEFCON_THRESHOLD, PROJECT_ROOT, feature_columns, season_has_defcon

logger = logging.getLogger(__name__)

MODELS_DIR: Final[Path] = PROJECT_ROOT / "models"
TARGET: Final[str] = "target_base"


def informative_columns(df: pd.DataFrame, cols: list[str]) -> list[str]:
    """Subset of ``cols`` with at least two distinct non-missing values in ``df``."""
    return [c for c in cols if df[c].nunique(dropna=True) >= 2]


# ======================================================================================
# Expected points regressors
# ======================================================================================
class BaseXPModel(ABC):
    """Common interface for expected-points models (template-method pattern).

    Subclasses override `_build` (estimator construction) and may override
    `predict` (e.g. the rolling baseline needs no estimator).
    """

    name: str = "base"

    def __init__(self, features: list[str] | None = None, random_state: int = 2026) -> None:
        self._features: list[str] = features or feature_columns()
        self._random_state = random_state
        self._estimator: Pipeline | HistGradientBoostingRegressor | None = None

    @property
    def features(self) -> list[str]:
        """Feature columns consumed by the model."""
        return list(self._features)

    @property
    def is_fitted(self) -> bool:
        """Whether `fit` has been called."""
        return self._estimator is not None

    @abstractmethod
    def _build(self) -> Pipeline | HistGradientBoostingRegressor:
        """Construct an unfitted scikit-learn estimator."""

    def _matrix(self, df: pd.DataFrame) -> np.ndarray:
        cols = getattr(self, "_active", self._features)
        return df[cols].to_numpy(dtype=float)

    def fit(self, df: pd.DataFrame, target: str = TARGET) -> "BaseXPModel":
        """Fit on rows of ``df`` with a non-null ``target``.

        Columns that are constant or entirely missing in the training window (e.g.
        DefCon features when training only on pre-2025 seasons) are dropped.
        """
        data = df[df[target].notna()]
        self._active = informative_columns(data, self._features)
        self._estimator = self._build()
        self._estimator.fit(self._matrix(data), data[target].to_numpy(dtype=float))
        return self

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        """Predict per-fixture DefCon-free expected points (clipped at -1)."""
        if self._estimator is None:
            raise RuntimeError(f"{self.name} model is not fitted")
        return np.clip(self._estimator.predict(self._matrix(df)), -1.0, None)


class HistGBXPModel(BaseXPModel):
    """Primary model: histogram gradient boosting (native NaN handling)."""

    name = "HistGradientBoosting"

    def _build(self) -> HistGradientBoostingRegressor:
        return HistGradientBoostingRegressor(
            loss="squared_error",
            learning_rate=0.05,
            max_iter=400,
            max_leaf_nodes=31,
            min_samples_leaf=40,
            l2_regularization=1.0,
            early_stopping=True,
            validation_fraction=0.1,
            n_iter_no_change=25,
            random_state=self._random_state,
        )


class RidgeXPModel(BaseXPModel):
    """Regularised linear baseline: median imputation + missing indicators + RidgeCV.

    The missing-value indicators act as ``defcon_available`` style flags for seasons
    without DefCon telemetry.
    """

    name = "RidgeCV"

    def _build(self) -> Pipeline:
        return make_pipeline(
            SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True),
            StandardScaler(),
            RidgeCV(alphas=np.logspace(-2, 3, 12)),
        )


class RollingAverageXPModel(BaseXPModel):
    """Naive baseline: the player's rolling 3-match average of DefCon-free points."""

    name = "Rolling3Avg"

    def _build(self) -> Pipeline:  # pragma: no cover - no estimator needed
        raise NotImplementedError

    def fit(self, df: pd.DataFrame, target: str = TARGET) -> "RollingAverageXPModel":
        """Stores the global mean used for players with no history."""
        self._fallback = float(df[target].mean())
        self._estimator = make_pipeline(StandardScaler())  # marks the model as fitted
        return self

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        """Rolling-3 total points minus the expected DefCon bonus already inside them."""
        pts = df["total_points_roll3"].to_numpy(dtype=float)
        defcon = np.nan_to_num(df["defcon_hit_roll3"].to_numpy(dtype=float)) * 2.0
        pred = pts - defcon
        return np.where(np.isnan(pred), getattr(self, "_fallback", 0.0), pred)


XP_MODELS: Final[dict[str, type[BaseXPModel]]] = {
    "hgb": HistGBXPModel,
    "ridge": RidgeXPModel,
    "rolling3": RollingAverageXPModel,
}


# ======================================================================================
# DefCon probability classifier
# ======================================================================================
class DefConClassifier:
    """Calibrated P(DefCon threshold hit) per fixture for outfield players.

    Trained only on rows where DefCon telemetry exists. When too little data exists
    (e.g. very early in a backtest) it falls back to per-position base rates.
    """

    MIN_ROWS: Final[int] = 2_000

    def __init__(self, features: list[str] | None = None, random_state: int = 2026) -> None:
        self._features = features or feature_columns()
        self._random_state = random_state
        self._model: CalibratedClassifierCV | None = None
        self._base_rates: dict[str, float] = {"DEF": 0.15, "MID": 0.08, "FWD": 0.01}

    @staticmethod
    def training_rows(df: pd.DataFrame) -> pd.DataFrame:
        """Outfield rows from DefCon seasons with a defined label."""
        mask = df["season"].map(season_has_defcon) & df["position"].ne("GK") & df["defcon_hit"].notna()
        return df[mask]

    def fit(self, df: pd.DataFrame) -> "DefConClassifier":
        """Fit the calibrated classifier (or only base rates if data is scarce)."""
        data = self.training_rows(df)
        if len(data):
            rates = data.groupby("position")["defcon_hit"].mean().to_dict()
            self._base_rates.update({k: float(v) for k, v in rates.items()})
        if len(data) < self.MIN_ROWS or data["defcon_hit"].nunique() < 2:
            self._model = None
            return self
        base = HistGradientBoostingClassifier(
            learning_rate=0.05, max_iter=300, max_leaf_nodes=31, min_samples_leaf=40,
            l2_regularization=1.0, random_state=self._random_state,
        )
        self._active = informative_columns(data, self._features)
        self._model = CalibratedClassifierCV(base, method="isotonic", cv=3)
        self._model.fit(data[self._active].to_numpy(dtype=float), data["defcon_hit"].astype(int))
        return self

    def predict_proba(self, df: pd.DataFrame) -> np.ndarray:
        """P(hit) per row; 0 for goalkeepers."""
        if self._model is not None:
            p = self._model.predict_proba(df[self._active].to_numpy(dtype=float))[:, 1]
        else:
            p = df["position"].map(self._base_rates).fillna(0.0).to_numpy(dtype=float)
        return np.where(df["position"].eq("GK").to_numpy(), 0.0, p)


# ======================================================================================
# Chronological evaluation
# ======================================================================================
def regression_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    """RMSE, MAE and R^2."""
    return {
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "r2": float(r2_score(y_true, y_pred)),
    }


def chronological_evaluation(
    df: pd.DataFrame,
    test_season: str = "2025-26",
    block_size: int = 5,
    model_keys: tuple[str, ...] = ("hgb", "ridge", "rolling3"),
    random_state: int = 2026,
    min_minutes_eval: int = 0,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Expanding-window evaluation on ``test_season``.

    For each block of ``block_size`` gameweeks, every model is trained on all prior
    seasons plus the test season's earlier gameweeks, then predicts the block.

    Returns:
        ``(metrics, predictions)`` where ``metrics`` has one row per model (overall) and
        ``predictions`` holds out-of-sample predictions for every test row.
    """
    test_mask = df["season"].eq(test_season)
    gws = sorted(df.loc[test_mask, "gw"].unique())
    preds: list[pd.DataFrame] = []
    for start in range(0, len(gws), block_size):
        block = gws[start:start + block_size]
        train = df[(df["season"] < test_season) | (test_mask & (df["gw"] < block[0]))]
        test = df[test_mask & df["gw"].isin(block)]
        keep = ["season", "gw", "element", "player_key", "name", "position", "team_id", "fixture", "value",
                "minutes", "minutes_roll3", TARGET, "total_points"]
        out = test[keep].copy()
        for key in model_keys:
            model = XP_MODELS[key](random_state=random_state).fit(train)
            out[f"pred_{key}"] = model.predict(test)
        clf = DefConClassifier(random_state=random_state).fit(train)
        out["p_defcon"] = clf.predict_proba(test)
        out["defcon_hit"] = test["defcon_hit"].to_numpy()
        preds.append(out)
        logger.info("Evaluated GW block %s-%s", block[0], block[-1])
    predictions = pd.concat(preds, ignore_index=True)
    eval_rows = predictions[predictions["minutes"] >= min_minutes_eval]
    metrics = pd.DataFrame(
        [{"model": XP_MODELS[k].name, **regression_metrics(eval_rows[TARGET], eval_rows[f"pred_{k}"])}
         for k in model_keys]
    )
    return metrics, predictions


# ======================================================================================
# GMM archetype discovery
# ======================================================================================
@dataclass(frozen=True)
class ArchetypeTemplate:
    """Weighted z-score signature used to name a cluster centroid."""

    name: str
    group: str  # 'defcon' | 'attacking' | 'premium' | 'budget' | 'other'
    weights: dict[str, float]


OUTFIELD_FEATURES: Final[tuple[str, ...]] = (
    "cost", "xg_per90", "xa_per90", "clean_sheets_per90", "cbit_per90", "cbirt_per90", "defcon_hit_rate",
)
GK_FEATURES: Final[tuple[str, ...]] = ("cost", "saves_per90", "clean_sheets_per90", "xgc_per90")

TEMPLATES: Final[dict[str, tuple[ArchetypeTemplate, ...]]] = {
    "GK": (
        ArchetypeTemplate("Premium Keeper", "premium", {"cost": 1.0, "clean_sheets_per90": 0.7, "xgc_per90": -0.5}),
        ArchetypeTemplate("Shot-Stopper", "other", {"saves_per90": 1.0, "xgc_per90": 0.5}),
        ArchetypeTemplate("Budget Bench Filler", "budget", {"cost": -1.0, "clean_sheets_per90": -0.3}),
        ArchetypeTemplate("Clean-Sheet Keeper", "other", {"clean_sheets_per90": 1.0, "cost": -0.2}),
    ),
    "DEF": (
        ArchetypeTemplate("High-CBIT Central Defender", "defcon",
                          {"cbit_per90": 1.0, "defcon_hit_rate": 1.0, "xa_per90": -0.5}),
        ArchetypeTemplate("Attacking Wing-Back", "attacking",
                          {"xa_per90": 1.0, "xg_per90": 0.6, "cbit_per90": -0.5}),
        ArchetypeTemplate("Premium Defender", "premium", {"cost": 1.0, "clean_sheets_per90": 0.6}),
        ArchetypeTemplate("Budget Bench Filler", "budget",
                          {"cost": -1.0, "clean_sheets_per90": -0.5, "xa_per90": -0.3}),
        ArchetypeTemplate("Ball-Winning Full-Back", "defcon", {"cbirt_per90": 1.0, "xa_per90": 0.3}),
    ),
    "MID": (
        ArchetypeTemplate("DefCon Floor Anchor (CDM)", "defcon",
                          {"cbirt_per90": 1.0, "defcon_hit_rate": 1.0, "xg_per90": -0.4}),
        ArchetypeTemplate("Premium Captain", "premium", {"cost": 1.0, "xg_per90": 0.7, "xa_per90": 0.5}),
        ArchetypeTemplate("Creative Playmaker", "attacking", {"xa_per90": 1.0, "cbirt_per90": -0.3}),
        ArchetypeTemplate("Goal-Threat Winger", "attacking", {"xg_per90": 1.0, "cost": -0.2}),
        ArchetypeTemplate("Budget Bench Filler", "budget", {"cost": -1.0, "xg_per90": -0.4, "xa_per90": -0.4}),
        ArchetypeTemplate("Box-to-Box Hybrid", "defcon", {"cbirt_per90": 0.6, "xg_per90": 0.4, "xa_per90": 0.4}),
    ),
    "FWD": (
        ArchetypeTemplate("Premium Captain", "premium", {"cost": 1.0, "xg_per90": 0.8}),
        ArchetypeTemplate("Value Striker", "attacking", {"xg_per90": 1.0, "cost": -0.5}),
        ArchetypeTemplate("Pressing Forward", "defcon", {"cbirt_per90": 1.0, "defcon_hit_rate": 0.5}),
        ArchetypeTemplate("Creative Forward", "attacking", {"xa_per90": 1.0}),
        ArchetypeTemplate("Budget Bench Filler", "budget", {"cost": -1.0, "xg_per90": -0.5}),
    ),
}


def season_player_aggregates(df: pd.DataFrame, season: str, min_minutes: int = 450) -> pd.DataFrame:
    """Season-level per-90 profile per player (for clustering)."""
    s = df[df["season"] == season].sort_values("kickoff_time")
    g = s.groupby("element")
    agg = g.agg(
        player_key=("player_key", "last"), name=("name", "last"), position=("position", "last"),
        team_id=("team_id", "last"), cost=("value", "last"), minutes=("minutes", "sum"),
        xg=("xg", "sum"), xa=("xa", "sum"), xgc=("xgc", "sum"), saves=("saves", "sum"),
        clean_sheets=("clean_sheets", "sum"), cbit=("cbit", "sum"), cbirt=("cbirt", "sum"),
        total_points=("total_points", "sum"),
    ).reset_index()
    played = s[s["minutes"] > 0].groupby("element")["defcon_hit"].mean()
    agg["defcon_hit_rate"] = agg["element"].map(played).fillna(0.0)
    m90 = agg["minutes"].replace(0, np.nan) / 90.0
    for c in ("xg", "xa", "xgc", "saves", "clean_sheets", "cbit", "cbirt"):
        agg[f"{c}_per90"] = (agg[c] / m90).fillna(0.0)
    agg["low_sample"] = agg["minutes"] < min_minutes
    return agg


@dataclass
class PositionGMM:
    """Fitted GMM for one position plus its scaler and cluster names."""

    position: str
    features: tuple[str, ...]
    scaler: StandardScaler
    gmm: GaussianMixture
    names: list[str]
    groups: list[str]
    bic_curve: dict[int, float]


@dataclass
class ArchetypeClusterer:
    """Per-position Gaussian Mixture archetype discovery with BIC model selection."""

    k_range: tuple[int, int] = (3, 9)
    gk_k_range: tuple[int, int] = (2, 4)
    min_minutes: int = 450
    random_state: int = 2026
    models: dict[str, PositionGMM] = field(default_factory=dict)

    @staticmethod
    def _max_k(n: int, d: int, k_hi: int) -> int:
        """Cap k so that (full-covariance parameters) stays below the sample size."""
        per_comp = d + d * (d + 1) / 2 + 1
        return max(1, min(k_hi, int(n // per_comp)))

    def _name_clusters(self, position: str, centroids_z: np.ndarray, feats: tuple[str, ...]) -> tuple[list[str], list[str]]:
        """Greedy unique assignment of template names to centroids by signature score."""
        templates = TEMPLATES[position]
        scores = np.array([[sum(w * c[feats.index(f)] for f, w in t.weights.items() if f in feats)
                            for t in templates] for c in centroids_z])
        names: list[str] = [""] * len(centroids_z)
        groups: list[str] = [""] * len(centroids_z)
        used: dict[str, int] = {}
        order = np.dstack(np.unravel_index(np.argsort(-scores, axis=None), scores.shape))[0]
        for ci, ti in order:
            if names[ci]:
                continue
            t = templates[ti]
            if t.name in used and len(used) < len(templates):
                continue
            used[t.name] = used.get(t.name, 0) + 1
            names[ci] = t.name if used[t.name] == 1 else f"{t.name} {used[t.name]}"
            groups[ci] = t.group
        return names, groups

    def fit(self, profiles: pd.DataFrame) -> "ArchetypeClusterer":
        """Fit one GMM per position on players with at least ``min_minutes``."""
        self.models = {}
        for pos in ("GK", "DEF", "MID", "FWD"):
            feats = GK_FEATURES if pos == "GK" else OUTFIELD_FEATURES
            k_lo, k_hi = self.gk_k_range if pos == "GK" else self.k_range
            data = profiles[(profiles["position"] == pos) & ~profiles["low_sample"]]
            X = data[list(feats)].to_numpy(dtype=float)
            scaler = StandardScaler().fit(X)
            Xz = scaler.transform(X)
            k_hi = max(k_lo, min(k_hi, len(Xz) // 10))
            bic: dict[int, float] = {}
            best: GaussianMixture | None = None
            for k in range(k_lo, k_hi + 1):
                gmm = GaussianMixture(
                    n_components=k, covariance_type="full", n_init=5, reg_covar=1e-2,
                    random_state=self.random_state,
                ).fit(Xz)
                bic[k] = float(gmm.bic(Xz))
                if best is None or bic[k] < bic[best.n_components]:
                    best = gmm
            assert best is not None
            names, groups = self._name_clusters(pos, best.means_, feats)
            self.models[pos] = PositionGMM(pos, feats, scaler, best, names, groups, bic)
            logger.info("GMM %s: k=%d (BIC sweep %s)", pos, best.n_components, bic)
        return self

    def transform(self, profiles: pd.DataFrame) -> pd.DataFrame:
        """Hard labels, posteriors and grouped soft probabilities for every player."""
        frames: list[pd.DataFrame] = []
        for pos, m in self.models.items():
            data = profiles[profiles["position"] == pos]
            if data.empty:
                continue
            Xz = m.scaler.transform(data[list(m.features)].to_numpy(dtype=float))
            post = m.gmm.predict_proba(Xz)
            out = data[["element", "player_key", "position"]].copy()
            out["archetype"] = [m.names[i] for i in post.argmax(axis=1)]
            out["archetype_confidence"] = post.max(axis=1)
            groups = np.array(m.groups)
            out["p_defcon_anchor"] = post[:, groups == "defcon"].sum(axis=1)
            out["p_attacking_outlet"] = post[:, np.isin(groups, ["attacking", "premium"])].sum(axis=1)
            out["posteriors"] = [dict(zip(m.names, map(float, row))) for row in post]
            frames.append(out)
        return pd.concat(frames, ignore_index=True)

    def summary(self) -> pd.DataFrame:
        """Per-position chosen k, BIC values and archetype names."""
        return pd.DataFrame(
            [{"position": p, "k": m.gmm.n_components, "archetypes": ", ".join(m.names),
              "bic": m.bic_curve} for p, m in self.models.items()]
        )


# ======================================================================================
# Production bundle
# ======================================================================================
@dataclass
class ModelBundle:
    """Production models persisted together for the live API."""

    xp_model: BaseXPModel
    defcon_model: DefConClassifier
    clusterer: ArchetypeClusterer
    profiles_season: str
    trained_through: str
    metadata: dict[str, object] = field(default_factory=dict)

    def save(self, path: Path = MODELS_DIR / "bundle.joblib") -> Path:
        """Serialize the bundle with joblib."""
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(self, path)
        return path

    @staticmethod
    def load(path: Path = MODELS_DIR / "bundle.joblib") -> "ModelBundle":
        """Load a bundle saved by `save`."""
        return joblib.load(path)

    def predict_fixtures(self, rows: pd.DataFrame) -> pd.DataFrame:
        """Add ``xp_base`` and ``p_defcon`` columns to per-fixture feature rows."""
        out = rows.copy()
        out["xp_base"] = self.xp_model.predict(rows)
        out["p_defcon"] = self.defcon_model.predict_proba(rows)
        return out


def defcon_threshold(position: str) -> float:
    """Re-export of the DefCon threshold for a position (inf for GK)."""
    return float(DEFCON_THRESHOLD[position])

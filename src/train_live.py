"""Production model trainer for the live FPL-Optimus API.

Fetches current-season finished gameweeks from the live FPL API (if reachable, else
falls back to local historical seasons), appends them to the historical dataset, and
trains:
1. Primary `HistGBXPModel` on all seasons + finished live GWs.
2. `DefConClassifier` on all DefCon-enabled seasons (2025-26+).
3. `ArchetypeClusterer` (GMM + BIC) on the latest season with >=450 min player profiles.

Saves `models/bundle.joblib` so the FastAPI server loads pre-trained models without
ever retraining on request.

Usage:
    python src/train_live.py [--seed 2026] [--offline-only]
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import time
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd  # noqa: E402

from src.data_loader import (  # noqa: E402
    FPLApiClient,
    FPLApiError,
    FeatureEngineer,
    HistoricalDataLoader,
    LiveDataBuilder,
    add_position_dummies,
    current_gameweek,
    current_season_label,
)
from src.models import (  # noqa: E402
    ArchetypeClusterer,
    DefConClassifier,
    HistGBXPModel,
    MODELS_DIR,
    ModelBundle,
    season_player_aggregates,
)

logger = logging.getLogger("train_live")


async def _fetch_live_history() -> tuple[pd.DataFrame, str]:
    """Fetch finished gameweek history for the current live season, if available."""
    async with FPLApiClient() as api:
        bootstrap = await api.get_bootstrap()
        fixtures = await api.get_fixtures()
        cur_gw, _ = current_gameweek(bootstrap)
        season = current_season_label(bootstrap)
        builder = LiveDataBuilder(api)
        hist = await builder.season_history(bootstrap, fixtures)
        return hist, f"{season} GW{cur_gw}"


def train_and_save_bundle(
    seed: int = 2026,
    offline_only: bool = False,
    out_path: Path = MODELS_DIR / "bundle.joblib",
) -> ModelBundle:
    """Train the production `ModelBundle` and persist it to ``out_path``."""
    t0 = time.perf_counter()
    raw_hist = HistoricalDataLoader().load_all()
    trained_through = f"{raw_hist['season'].max()} GW{int(raw_hist.loc[raw_hist['season'] == raw_hist['season'].max(), 'gw'].max())}"

    if not offline_only:
        try:
            live_df, live_label = asyncio.run(_fetch_live_history())
            if not live_df.empty:
                live_season = str(live_df["season"].iloc[0])
                raw_hist = raw_hist[raw_hist["season"] != live_season]
                raw_hist = pd.concat([raw_hist, live_df], ignore_index=True)
                trained_through = live_label
                logger.info("Included %d live match rows (%s)", len(live_df), live_label)
        except (FPLApiError, Exception) as exc:
            logger.warning("Live API unavailable (%s); training on offline historical data only", exc)

    feats = add_position_dummies(FeatureEngineer().build_training_features(raw_hist))
    logger.info("Training HistGBXPModel on %d rows...", len(feats))
    xp_model = HistGBXPModel(random_state=seed).fit(feats)

    logger.info("Training DefConClassifier...")
    defcon_model = DefConClassifier(random_state=seed).fit(feats)

    # Pick latest season that has enough players with >=450 minutes for GMM clustering.
    latest_season = str(feats["season"].max())
    profiles = season_player_aggregates(feats, latest_season)
    if (~profiles["low_sample"]).sum() < 60:
        latest_season = "2025-26"
        profiles = season_player_aggregates(feats, latest_season)
    logger.info("Fitting GMM ArchetypeClusterer on %s profiles...", latest_season)
    clusterer = ArchetypeClusterer(random_state=seed).fit(profiles)

    bundle = ModelBundle(
        xp_model=xp_model,
        defcon_model=defcon_model,
        clusterer=clusterer,
        profiles_season=latest_season,
        trained_through=trained_through,
        metadata={"seed": seed, "rows": int(len(feats)), "runtime_s": round(time.perf_counter() - t0, 2)},
    )
    bundle.save(out_path)
    logger.info("Saved production bundle to %s (%.1fs)", out_path, time.perf_counter() - t0)
    return bundle


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--offline-only", action="store_true", help="Skip live FPL API fetch")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    train_and_save_bundle(seed=args.seed, offline_only=args.offline_only)
    return 0


if __name__ == "__main__":
    sys.exit(main())

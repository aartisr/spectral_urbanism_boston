from __future__ import annotations

from typing import Any

import pandas as pd



def build_data_quality_report(grid_feat: pd.DataFrame, cfg: dict[str, Any]) -> dict[str, Any]:
  features_cfg = cfg.get("features", {})
  observed_temp_column = str(features_cfg.get("observed_temp_column", "lst"))
  equity_column = str(cfg.get("objective", {}).get("equity", {}).get("svi_column", "SVI"))

  report_columns = [observed_temp_column, equity_column]
  defaults = features_cfg.get("defaults", {})
  if isinstance(defaults, dict):
    report_columns.extend([str(k) for k in defaults.keys()])

  column_stats: dict[str, dict[str, Any]] = {}
  for col in sorted(set(report_columns)):
    if col not in grid_feat.columns:
      column_stats[col] = {"present": False}
      continue

    series = pd.to_numeric(grid_feat[col], errors="coerce")
    missing = int(series.isna().sum())
    total = int(len(series))
    column_stats[col] = {
      "present": True,
      "rows": total,
      "missing": missing,
      "missing_rate": float(missing / total) if total else 0.0,
      "min": float(series.min()) if total and series.notna().any() else None,
      "max": float(series.max()) if total and series.notna().any() else None,
      "mean": float(series.mean()) if total and series.notna().any() else None,
      "std": float(series.std()) if total and series.notna().any() else None,
      "unique_values": int(series.nunique(dropna=True)) if total else 0,
    }

  temp_stats = column_stats.get(observed_temp_column, {})
  temp_present = bool(temp_stats.get("present", False))
  temp_std = float(temp_stats.get("std", 0.0) or 0.0)
  temp_unique = int(temp_stats.get("unique_values", 0) or 0)
  thermal_variation_gate_passed = temp_present and temp_std >= 0.1 and temp_unique >= 5

  return {
    "rows": int(len(grid_feat)),
    "columns": column_stats,
    "quality_gate_passed": all(v.get("present", False) for v in column_stats.values()),
    "thermal_variation_gate_passed": thermal_variation_gate_passed,
    "thermal_variation_note": (
      "Observed temperature variation is too low for operational heat-corridor confidence"
      if not thermal_variation_gate_passed
      else "Observed temperature variation is sufficient for corridor derivation"
    ),
  }

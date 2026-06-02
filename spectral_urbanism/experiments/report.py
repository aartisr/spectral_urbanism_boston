from __future__ import annotations

import json
import os
import pandas as pd
from typing import Any, Dict, List

def save_json(path: str, obj: Any) -> None:
  os.makedirs(os.path.dirname(path), exist_ok=True)
  with open(path, "w", encoding="utf-8") as f:
    json.dump(obj, f, indent=2)

def save_history_csv(path: str, history: List[Dict[str, float]]) -> None:
  os.makedirs(os.path.dirname(path), exist_ok=True)
  pd.DataFrame(history).to_csv(path, index=False)

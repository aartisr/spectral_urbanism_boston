import networkx as nx
import numpy as np
import pandas as pd

from spectral_urbanism.metrics.cooling_access import cooling_access_to_sinks, infer_cooling_sinks


def test_intersection_sink_selection_preserves_access_variation() -> None:
  """A selective sink definition must not collapse access into a binary flag."""
  frame = pd.DataFrame(
    {
      "cell_id": list(range(9)),
      "ndvi": [0.95, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1],
      "observed_temp": [20.0, 22.0, 24.0, 26.0, 28.0, 30.0, 32.0, 34.0, 36.0],
    }
  )
  graph = nx.path_graph(range(9))
  nx.set_edge_attributes(graph, 1.0, "weight")

  sinks = infer_cooling_sinks(frame, ndvi_quantile=0.75, temp_quantile=0.25)
  access = cooling_access_to_sinks(graph, sinks)

  assert sinks == {0, 1, 2}
  assert len({round(value, 6) for value in access.values()}) > 2
  assert access[0] == 100.0
  assert access[8] < access[4] < access[2]


def test_union_sink_selection_remains_explicitly_opt_in() -> None:
  frame = pd.DataFrame(
    {
      "cell_id": list(range(8)),
      "ndvi": [0.9, 0.8, 0.7, 0.6, 0.1, 0.1, 0.1, 0.1],
      "observed_temp": [35.0, 34.0, 33.0, 32.0, 20.0, 21.0, 22.0, 23.0],
    }
  )

  intersection = infer_cooling_sinks(frame, ndvi_quantile=0.75, temp_quantile=0.25)
  union = infer_cooling_sinks(frame, ndvi_quantile=0.75, temp_quantile=0.25, selection_mode="union")

  assert len(intersection) < len(union)

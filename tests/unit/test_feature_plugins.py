from __future__ import annotations

import pandas as pd

from spectral_urbanism.city import plugins as plugins_module
from spectral_urbanism.data.catalog import DataPaths


class _FakeEP:
  def __init__(self, name: str, obj):
    self.name = name
    self._obj = obj

  def load(self):
    return self._obj


class _FakeEPs:
  def __init__(self, group: str, eps: list[_FakeEP]):
    self._group = group
    self._eps = eps

  def select(self, *, group: str):
    if group == self._group:
      return self._eps
    return []


def test_discover_feature_plugins_registers_external_plugin(monkeypatch) -> None:
  registry_before = dict(plugins_module._FEATURE_PLUGINS)
  discovered_before = set(plugins_module._DISCOVERED_GROUPS)

  def _external_plugin(grid, cfg, dp):
    out = grid.copy()
    out["external_score"] = 7.0
    return out

  monkeypatch.setattr(
    plugins_module,
    "entry_points",
    lambda: _FakeEPs("spectral_urbanism.feature_plugins", [_FakeEP("external_plugin", _external_plugin)]),
  )

  try:
    plugins_module.discover_feature_plugins(force=True)
    assert "external_plugin" in plugins_module.list_feature_plugins()

    grid = pd.DataFrame({"cell_id": [0, 1]})
    cfg = {"features": {"plugins": ["external_plugin"], "auto_discover_plugins": False}}
    out = plugins_module.apply_feature_plugins(grid, cfg, DataPaths(values={}))
    assert list(out["external_score"]) == [7.0, 7.0]
  finally:
    plugins_module._FEATURE_PLUGINS.clear()
    plugins_module._FEATURE_PLUGINS.update(registry_before)
    plugins_module._DISCOVERED_GROUPS.clear()
    plugins_module._DISCOVERED_GROUPS.update(discovered_before)


def test_apply_feature_plugins_supports_import_path_plugin() -> None:
  registry_before = dict(plugins_module._FEATURE_PLUGINS)
  discovered_before = set(plugins_module._DISCOVERED_GROUPS)

  try:
    grid = pd.DataFrame({"cell_id": [0]})
    cfg = {
      "features": {
        "auto_discover_plugins": False,
        "plugins": ["spectral_urbanism.city.plugins:_defaults_plugin"],
      }
    }
    out = plugins_module.apply_feature_plugins(grid, cfg, DataPaths(values={}))
    assert "lst" in out.columns
  finally:
    plugins_module._FEATURE_PLUGINS.clear()
    plugins_module._FEATURE_PLUGINS.update(registry_before)
    plugins_module._DISCOVERED_GROUPS.clear()
    plugins_module._DISCOVERED_GROUPS.update(discovered_before)


def test_validate_feature_plugin_plan_enforces_contract_version() -> None:
  registry_before = dict(plugins_module._FEATURE_PLUGINS)
  discovered_before = set(plugins_module._DISCOVERED_GROUPS)

  try:
    def _versioned_plugin(grid, cfg, dp):
      return grid

    plugins_module.register_feature_plugin(
      "versioned_plugin",
      _versioned_plugin,
      contract_version="2.0",
      capabilities={"x"},
    )

    cfg = {
      "objective": {"equity": {"svi_column": "SVI"}},
      "features": {
        "auto_discover_plugins": False,
        "plugin_contract_version": "1.0",
        "plugins": ["versioned_plugin"],
      },
    }
    errors, _, _ = plugins_module.validate_feature_plugin_plan(cfg)
    assert any("contract version" in err for err in errors)
  finally:
    plugins_module._FEATURE_PLUGINS.clear()
    plugins_module._FEATURE_PLUGINS.update(registry_before)
    plugins_module._DISCOVERED_GROUPS.clear()
    plugins_module._DISCOVERED_GROUPS.update(discovered_before)


def test_validate_feature_plugin_plan_enforces_required_columns() -> None:
  registry_before = dict(plugins_module._FEATURE_PLUGINS)
  discovered_before = set(plugins_module._DISCOVERED_GROUPS)

  try:
    def _column_plugin(grid, cfg, dp):
      return grid

    plugins_module.register_feature_plugin(
      "column_plugin",
      _column_plugin,
      required_columns={"population_density"},
      capabilities={"demographics"},
    )

    cfg = {
      "objective": {"equity": {"svi_column": "SVI"}},
      "features": {
        "auto_discover_plugins": False,
        "plugins": ["column_plugin"],
      },
    }
    errors, _, _ = plugins_module.validate_feature_plugin_plan(cfg)
    assert any("missing columns" in err for err in errors)
  finally:
    plugins_module._FEATURE_PLUGINS.clear()
    plugins_module._FEATURE_PLUGINS.update(registry_before)
    plugins_module._DISCOVERED_GROUPS.clear()
    plugins_module._DISCOVERED_GROUPS.update(discovered_before)


def test_discovery_preserves_existing_builtin_contract(monkeypatch) -> None:
  registry_before = dict(plugins_module._FEATURE_PLUGINS)
  discovered_before = set(plugins_module._DISCOVERED_GROUPS)

  builtin_name = "equity_placeholder"
  before_contract = plugins_module.get_feature_plugin_contract(builtin_name)
  assert "equity" in before_contract.capabilities

  monkeypatch.setattr(
    plugins_module,
    "entry_points",
    lambda: _FakeEPs(
      "spectral_urbanism.feature_plugins",
      [
        _FakeEP(
          builtin_name,
          plugins_module._equity_placeholder_plugin,
        )
      ],
    ),
  )

  try:
    plugins_module.discover_feature_plugins(force=True)
    after_contract = plugins_module.get_feature_plugin_contract(builtin_name)
    assert "equity" in after_contract.capabilities
    assert after_contract.version == before_contract.version
    assert after_contract.description == before_contract.description
  finally:
    plugins_module._FEATURE_PLUGINS.clear()
    plugins_module._FEATURE_PLUGINS.update(registry_before)
    plugins_module._DISCOVERED_GROUPS.clear()
    plugins_module._DISCOVERED_GROUPS.update(discovered_before)

from __future__ import annotations

from pathlib import Path

from click.testing import CliRunner

from spectral_urbanism.cli import main



def test_init_city_creates_config(tmp_path: Path) -> None:
  runner = CliRunner()
  output_path = tmp_path / "my_city.yaml"
  result = runner.invoke(main, ["init-city", "--name", "MyCity", "--out", str(output_path)])
  assert result.exit_code == 0
  assert output_path.exists()
  assert "MyCity" in output_path.read_text(encoding="utf-8")



def test_validate_data_passes_on_template(tmp_path: Path) -> None:
  runner = CliRunner()
  config_path = tmp_path / "my_city.yaml"
  init_result = runner.invoke(main, ["init-city", "--name", "MyCity", "--out", str(config_path)])
  assert init_result.exit_code == 0

  result = runner.invoke(main, ["validate-data", "--config", str(config_path)])
  assert result.exit_code == 0
  assert "Validation passed" in result.output

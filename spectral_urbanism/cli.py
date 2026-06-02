from __future__ import annotations
from pathlib import Path

import click
from spectral_urbanism.city.plugins import validate_feature_plugin_plan
from spectral_urbanism.config.schema import CityPipelineConfig
from spectral_urbanism.experiments.benchmark import run_ablations, run_benchmark
from spectral_urbanism.pipelines.run_city import run as run_city
from spectral_urbanism.utils.io import load_yaml

@click.group()
def main() -> None:
  """Spectral Urbanism CLI."""
  pass

@main.command()
@click.option("--config", "config_path", required=True, type=click.Path(exists=True))
def run(config_path: str) -> None:
  """Run end-to-end city pipeline from config."""
  out_dir = run_city(config_path)
  click.echo(f"Wrote outputs to: {out_dir}")


@main.command("init-city")
@click.option("--name", required=True, type=str)
@click.option("--out", "out_path", required=True, type=click.Path())
def init_city(name: str, out_path: str) -> None:
  """Create a new city config from the template."""
  root = Path(__file__).resolve().parents[1]
  template_path = root / "configs" / "city.template.yaml"
  if not template_path.exists():
    template_path = Path.cwd() / "configs" / "city.template.yaml"

  if not template_path.exists():
    raise click.ClickException("Could not find configs/city.template.yaml")

  cfg = load_yaml(str(template_path))
  cfg.setdefault("city", {})["name"] = name
  cfg.setdefault("run", {})["run_id"] = f"{name.lower().replace(' ', '_')}_dev"

  out_file = Path(out_path)
  out_file.parent.mkdir(parents=True, exist_ok=True)
  import yaml

  out_file.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
  click.echo(f"Created city config: {out_file}")


@main.command("validate-data")
@click.option("--config", "config_path", required=True, type=click.Path(exists=True))
def validate_data(config_path: str) -> None:
  """Validate config schema and plugin/data readiness."""
  cfg = CityPipelineConfig.model_validate(load_yaml(config_path)).model_dump(mode="python")
  errors, warnings, health = validate_feature_plugin_plan(cfg)

  data_paths = cfg.get("data_paths", {})
  missing_paths = [k for k, p in data_paths.items() if not Path(str(p)).exists()]

  if missing_paths:
    warnings.append("Missing data paths: " + ", ".join(sorted(map(str, missing_paths))))

  if warnings:
    for w in warnings:
      click.echo(f"WARN: {w}")

  click.echo(f"Plugin health entries: {len(health)}")
  if errors:
    for e in errors:
      click.echo(f"ERROR: {e}")
    raise click.ClickException("Validation failed")

  click.echo("Validation passed")


@main.command("run-benchmark")
@click.option("--config", "config_path", required=True, type=click.Path(exists=True))
def run_benchmark_cmd(config_path: str) -> None:
  """Run baseline benchmark suite and write benchmark artifacts."""
  out_dir = run_benchmark(config_path)
  click.echo(f"Wrote benchmark outputs to: {out_dir}")


@main.command("run-ablation")
@click.option("--config", "config_path", required=True, type=click.Path(exists=True))
def run_ablation_cmd(config_path: str) -> None:
  """Run objective-term ablations over selected interventions."""
  out_dir = run_ablations(config_path)
  click.echo(f"Wrote ablation outputs to: {out_dir}")

if __name__ == "__main__":
  main()

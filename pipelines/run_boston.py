from __future__ import annotations

from spectral_urbanism.pipelines.run_city import run

if __name__ == "__main__":
  import argparse
  ap = argparse.ArgumentParser()
  ap.add_argument("--config", required=True)
  args = ap.parse_args()
  out = run(args.config)
  print(out)

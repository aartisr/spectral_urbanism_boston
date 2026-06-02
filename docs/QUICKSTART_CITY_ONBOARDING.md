# Quickstart City Onboarding

## Create City Config
```bash
spectral-urbanism init-city --name "MyCity" --out configs/my_city.yaml
```

## Validate
```bash
spectral-urbanism validate-data --config configs/my_city.yaml
```

## Run
```bash
spectral-urbanism run --config configs/my_city.yaml
```

## Benchmark + Ablations
```bash
spectral-urbanism run-benchmark --config configs/my_city.yaml
spectral-urbanism run-ablation --config configs/my_city.yaml
```

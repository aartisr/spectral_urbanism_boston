# Data Contracts

## Required Config Sections
- run
- city
- data_paths
- graph
- gmrf
- interventions
- objective

## Feature Contract
- Configurable plugin pipeline under `features.plugins`.
- Expected plugin contract version under `features.plugin_contract_version`.
- Required capabilities under `features.required_capabilities`.

## Data Paths Contract
- `data_paths` accepts extensible keys.
- `data_paths.root` is required.
- Missing files are surfaced via `validate-data` warnings and provenance manifest `exists` flags.

## Required Columns Contract
- Plugin contracts may declare `required_columns`.
- Validation fails when required columns are unavailable from config defaults/rasters/provided columns.

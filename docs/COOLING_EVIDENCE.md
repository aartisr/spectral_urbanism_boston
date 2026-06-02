# Cooling Evidence and Planner Assumptions

This document records where the `Flip-to-Cool Action Plan` gets its cooling evidence and how the app converts that evidence into local planning estimates.

## What Is Proven

The app uses public, institutional heat-island mitigation guidance from the U.S. Environmental Protection Agency (EPA) as the evidence base for intervention categories:

- Trees and vegetation: EPA states that trees and vegetation lower surface and air temperatures through shade and evapotranspiration. EPA's benefits page cites a review of 308 studies where urban forests averaged 1.6 C cooler than urban non-green areas.
- Trees and vegetation, peak shading context: EPA's heat-island materials note that shaded surfaces can be substantially cooler than unshaded materials, and evapotranspiration can reduce peak summer temperatures.
- Cool pavements: EPA describes cool pavements as materials that reflect more solar energy, enhance evaporation, or otherwise remain cooler than conventional pavements. EPA cites an Arizona pilot where cool pavement surfaces were 10 to 16 F cooler than conventional asphalt at midday.
- Cool roofs: EPA states that cool roofs use high solar reflectance and thermal emittance to reduce roof, indoor, and surrounding ambient temperatures. EPA reports lower maximum indoor temperatures in non-air-conditioned residential buildings and reduced cooling demand in air-conditioned buildings.
- Green roofs / vegetation: EPA states that green roofs have been proven to reduce heat islands by providing shade, removing heat from the air, and reducing roof-surface and surrounding-air temperatures.

## Sources

- U.S. EPA, Benefits of Trees and Vegetation: https://www.epa.gov/heatislands/benefits-trees-and-vegetation
- U.S. EPA, Using Trees and Vegetation to Reduce Heat Islands: https://www.epa.gov/heatislands/using-trees-and-vegetation-reduce-heat-islands
- U.S. EPA, Using Cool Pavements to Reduce Heat Islands: https://www.epa.gov/heatislands/using-cool-pavements-reduce-heat-islands
- U.S. EPA, Using Cool Roofs to Reduce Heat Islands: https://www.epa.gov/heatislands/using-cool-roofs-reduce-heat-islands
- U.S. EPA, Using Green Roofs to Reduce Heat Islands: https://www.epa.gov/heat-islands/using-green-roofs-reduce-heat-islands
- U.S. EPA, Guide to Reducing Heat Islands: https://www.epa.gov/heatislands/guide-reducing-heat-islands

## How The App Uses This Evidence

The planner does not claim that a single intervention will deterministically reduce Boston street temperature by a fixed amount. Instead, it uses conservative low / expected / high cooling bands for each intervention family, then tests intervention mixes against the run's local heat-corridor threshold.

Current planning bands in `web/src/routes/map-utils.ts`:

| Intervention | Low C | Expected C | High C | Evidence basis |
| --- | ---: | ---: | ---: | --- |
| `shade_corridor` | 0.35 | 0.85 | 1.35 | Trees/vegetation shade and evapotranspiration evidence; applied as a corridor-level continuous-shade strategy. |
| `tree` | 0.25 | 0.65 | 1.10 | EPA urban forest and vegetation cooling evidence, conservatively downscaled to local street-cell planning. |
| `reflective_pavement` | 0.15 | 0.45 | 0.90 | EPA cool-pavement evidence; surface-temperature evidence is downweighted because air-temperature/corridor-temperature effects are smaller and context dependent. |
| `green_space` | 0.12 | 0.38 | 0.75 | EPA green infrastructure and green-roof vegetation evidence; downscaled for pocket or median planting. |
| `water_feature` | 0.08 | 0.28 | 0.55 | Evaporative cooling mechanism; lower confidence unless local operations/maintenance feasibility is confirmed. |
| `cool_roof` | 0.05 | 0.22 | 0.50 | EPA cool-roof evidence; downscaled for street-corridor effects because much of the benefit is building/roof-specific. |

## Confidence Calculation

For a selected street, the planner:

1. Reads the current run's heat-corridor threshold.
2. Computes the temperature reduction needed to move the street below that threshold.
3. Builds several candidate intervention mixes using available intervention types and configured costs.
4. Calculates low / expected / high cooling for each mix.
5. Estimates confidence from how often the cooling band clears the required reduction, adjusted by local selected-cell coverage.
6. Penalizes overly expensive or complex mixes when ranking plans.

## Important Limitations

- EPA sources prove the mitigation categories and provide observed ranges in relevant contexts; they do not provide exact Boston-block-level coefficients for this specific run.
- Surface-temperature reductions are not the same as air-temperature reductions. The app therefore downweights cool pavement and roof effects for street-corridor planning.
- The current budget estimate uses configured planning cost units, not dollars. Dollar budgeting requires local unit costs, procurement assumptions, maintenance assumptions, and site feasibility.
- Confidence should be treated as decision support, not a guarantee. The strongest next improvement is to calibrate these bands with Boston-specific before/after intervention data.

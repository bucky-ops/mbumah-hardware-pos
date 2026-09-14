/**
 * County narrative types for the map layer.
 *
 * `web/data/county_narratives.json` maps each of the 51 Kenyan counties
 * to a short, field-informed story used by the GIS map detail panel.
 */

/** Human-readable context for a single county. */
export interface CountyNarrative {
  /** Structural drivers of malnutrition in this county (drought, poverty, WASH…). */
  drivers: string[];
  /** Representative composite testimony (never a real named individual). */
  testimony: string;
  /** Ongoing programmes and interventions in the county. */
  initiatives: string[];
  /** A documented community success story. */
  success_story: string;
}

/** All county narratives, keyed by county name (e.g. `Record['Garissa']`). */
export type CountyNarratives = Record<string, CountyNarrative>;

/**
 * Client-side child malnutrition risk screening (heuristic).
 *
 * Consumed by `web/components/AssessClient.tsx`. All processing happens in
 * the browser — nothing is transmitted or stored.
 *
 * IMPORTANT: this is a transparent WHO-guideline approximation, not the
 * Random Forest model in `src/models/`. Growth-standard medians are
 * interpolated from WHO Child Growth Standards reference points so the
 * z-scores shown are indicative, not clinical measurements. A full LMS
 * implementation can replace `whoMedian*` / `whoSd*` helpers later without
 * changing the component contract.
 */

export type Sex = 'male' | 'female';

export interface AssessmentInput {
  /** Child age in months (6–60 per WHO child growth standard scope). */
  age_months: number;
  sex: Sex;
  weight_kg?: number;
  height_cm?: number;
  /** Mid-upper arm circumference in mm — optional but strongly predictive. */
  muac_mm?: number;
  /** Food groups eaten in the last 24 h (0–7). */
  dietary_diversity?: number;
  meals_per_day?: number;
  /** Diarrhoea / fever / respiratory illness in the last 2 weeks. */
  recent_illness?: boolean;
  currently_breastfeeding?: boolean;
  breastfeeding?: boolean;
  caregiver_education: 'none' | 'primary' | 'secondary' | 'tertiary';
  improved_water?: boolean;
}

export type AssessmentRisk = 'normal' | 'watch' | 'moderate' | 'high' | 'critical';

export interface AssessmentResult {
  risk: AssessmentRisk;
  risk_label: string;
  risk_color: string;
  immediate_action: boolean;
  whz: number | null;
  haz: number | null;
  waz: number | null;
  findings: string[];
  recommendations: string[];
}

/** WHO median height-for-age (cm) anchor points, by month age. */
const HEIGHT_MEDIAN: Record<string, { male: number; female: number }> = {
  '6': { male: 67.6, female: 65.7 },
  '12': { male: 75.7, female: 74.0 },
  '24': { male: 87.8, female: 86.4 },
  '36': { male: 96.1, female: 95.1 },
  '48': { male: 103.3, female: 102.7 },
  '60': { male: 110.0, female: 109.4 },
};

/** WHO median weight-for-age (kg) anchor points, by month age. */
const WEIGHT_MEDIAN: Record<string, { male: number; female: number }> = {
  '6': { male: 7.9, female: 7.3 },
  '12': { male: 9.6, female: 8.9 },
  '24': { male: 12.2, female: 11.5 },
  '36': { male: 14.3, female: 13.9 },
  '48': { male: 16.3, female: 16.1 },
  '60': { male: 18.3, female: 18.2 },
};

function interp(table: Record<string, { male: number; female: number }>, months: number, sex: Sex): number {
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  const m = Math.min(Math.max(months, keys[0]), keys[keys.length - 1]);
  const lo = Math.max(...keys.filter((k) => k <= m));
  const hi = Math.min(...keys.filter((k) => k >= m));
  const loV = table[String(lo)][sex];
  const hiV = table[String(hi)][sex];
  if (hi === lo) return hiV;
  return loV + ((m - lo) / (hi - lo)) * (hiV - loV);
}

const whoMedianHeight = (months: number, sex: Sex) => interp(HEIGHT_MEDIAN, months, sex);
const whoMedianWeight = (months: number, sex: Sex) => interp(WEIGHT_MEDIAN, months, sex);
const whoSdHeight = (months: number) => (months < 24 ? 2.6 : 3.2);
const whoSdWeight = (months: number) => (months < 24 ? 1.1 : 1.4);
const whoSdWhz = () => 0.95;

/** Approximate median BMI (kg/m²) for under-fives by age. */
function whoMedianBmi(months: number): number {
  const anchors: Array<[number, number]> = [
    [6, 16.8], [12, 16.4], [24, 15.7], [36, 15.3], [48, 15.1], [60, 15.0],
  ];
  const m = Math.min(Math.max(months, 6), 60);
  for (let i = 1; i < anchors.length; i++) {
    const [loA, loV] = anchors[i - 1];
    const [hiA, hiV] = anchors[i];
    if (m <= hiA) return loV + ((m - loA) / (hiA - loA)) * (hiV - loV);
  }
  return 15.0;
}

/**
 * Screen a child's anthropometry + context and return a classification
 * with WHO-style z-scores, findings and recommendations.
 */
export function assessRisk(input: AssessmentInput): AssessmentResult {
  const findings: string[] = [];
  const recommendations: string[] = [];
  let immediate = false;

  const age = Math.min(Math.max(input.age_months || 6, 6), 60);
  const sex = input.sex === 'female' ? 'female' : 'male';

  // ── Z-scores ─────────────────────────────────────────────────────────
  let haz: number | null = null;
  let waz: number | null = null;
  let whz: number | null = null;

  if (input.height_cm && input.height_cm > 0) {
    haz = (input.height_cm - whoMedianHeight(age, sex)) / whoSdHeight(age);
    haz = Math.round(haz * 100) / 100;
  }
  if (input.weight_kg && input.weight_kg > 0) {
    waz = (input.weight_kg - whoMedianWeight(age, sex)) / whoSdWeight(age);
    waz = Math.round(waz * 100) / 100;
    if (input.height_cm && input.height_cm > 0) {
      const bmi = input.weight_kg / Math.pow(input.height_cm / 100, 2);
      whz = (bmi - whoMedianBmi(age)) / whoSdWhz();
      whz = Math.round(whz * 100) / 100;
    }
  }

  // ── Anthropometric findings ──────────────────────────────────────────
  const wasting = whz !== null && whz < -2;
  const severeWasting = whz !== null && whz < -3;
  const stunting = haz !== null && haz < -2;
  const underweight = waz !== null && waz < -2;

  if (severeWasting) {
    findings.push(`Severe wasting (WHZ ${whz!.toFixed(2)} < −3): visible severe acute malnutrition.`);
  } else if (wasting) {
    findings.push(`Moderate wasting (WHZ ${whz!.toFixed(2)} between −3 and −2).`);
  } else if (whz !== null) {
    findings.push(`Weight-for-height within normal range (WHZ ${whz.toFixed(2)}).`);
  }

  if (stunting) findings.push(`Stunting suspected (HAZ ${haz!.toFixed(2)} < −2): chronic undernutrition.`);
  if (underweight) findings.push(`Underweight (WAZ ${waz!.toFixed(2)} < −2).`);

  // ── MUAC (independent SAM/MAM gate) ──────────────────────────────────
  let muacFlag: 'sam' | 'mam' | 'normal' | null = null;
  if (input.muac_mm && input.muac_mm > 0) {
    if (input.muac_mm < 115) {
      muacFlag = 'sam';
      findings.push(`MUAC ${input.muac_mm} mm < 115 mm: severe acute malnutrition by arm circumference.`);
    } else if (input.muac_mm < 125) {
      muacFlag = 'mam';
      findings.push(`MUAC ${input.muac_mm} mm (115–124 mm): moderate acute malnutrition range.`);
    } else {
      muacFlag = 'normal';
      findings.push(`MUAC ${input.muac_mm} mm ≥ 125 mm: adequate arm circumference.`);
    }
  }

  // ── Contextual findings ──────────────────────────────────────────────
  if (input.dietary_diversity !== undefined && input.dietary_diversity < 4) {
    findings.push(`Low dietary diversity (${input.dietary_diversity}/7 food groups in last 24 h).`);
  }
  if (input.meals_per_day !== undefined && input.meals_per_day < 3) {
    findings.push(`Reduced meal frequency (${input.meals_per_day}/day).`);
  }
  if (input.recent_illness) {
    findings.push('Recent illness (last 2 weeks) increases nutrient requirements and appetite loss.');
  }
  if (input.improved_water === false) {
    findings.push('Unimproved water source raises infection recurrence risk.');
  }

  // ── Classification ───────────────────────────────────────────────────
  let risk: AssessmentRisk;
  if (severeWasting || muacFlag === 'sam') {
    risk = 'critical';
    immediate = true;
  } else if (muacFlag === 'mam' || (wasting && (input.recent_illness || input.dietary_diversity !== undefined && input.dietary_diversity < 4))) {
    risk = 'high';
  } else if (wasting || stunting || underweight) {
    risk = 'moderate';
  } else if (
    (input.dietary_diversity !== undefined && input.dietary_diversity < 4) ||
    input.recent_illness ||
    input.improved_water === false ||
    (input.meals_per_day !== undefined && input.meals_per_day < 3)
  ) {
    risk = 'watch';
  } else {
    risk = 'normal';
  }

  const LABEL: Record<AssessmentRisk, string> = {
    normal: 'Normal nutritional status',
    watch: 'At risk — monitor closely',
    moderate: 'Moderate malnutrition risk',
    high: 'High malnutrition risk (MAM range)',
    critical: 'Severe acute malnutrition (SAM)',
  };
  const COLOR: Record<AssessmentRisk, string> = {
    normal: '#059669',
    watch: '#d97706',
    moderate: '#f59e0b',
    high: '#ea580c',
    critical: '#dc2626',
  };

  // ── Recommendations ──────────────────────────────────────────────────
  if (risk === 'critical') {
    recommendations.push('Refer for immediate medical assessment — SAM requires urgent facility-based or IMAM outpatient care.');
    recommendations.push('Screen for medical complications (fever, dehydration, oedema) before any feeding plan.');
  } else if (risk === 'high') {
    recommendations.push('Enrol in a supplementary feeding programme (SFP) and re-measure MUAC weekly.');
    recommendations.push('Provide energy-dense complementary foods and treat any current illness.');
  } else if (risk === 'moderate') {
    recommendations.push('Nutritional counselling with follow-up weighing in 2 weeks.');
    recommendations.push('Add fortified foods; review feeding frequency and portion sizes.');
  } else if (risk === 'watch') {
    recommendations.push('Improve dietary diversity (aim for ≥ 4 food groups daily) and meal frequency.');
    if (input.improved_water === false) recommendations.push('Use treated or improved water sources to reduce infection risk.');
    recommendations.push('Reassess in 1 month or sooner if illness occurs.');
  } else {
    recommendations.push('Continue current feeding, growth monitoring and routine immunisations.');
    recommendations.push('Re-screen at every health contact or if appetite/activity drops.');
  }
  if (input.caregiver_education === 'none') {
    recommendations.push('Offer caregiver nutrition education with pictorial feeding guides.');
  }
  if (input.breastfeeding === false && input.currently_breastfeeding === false && age < 24) {
    recommendations.push('Review age-appropriate breastfeeding / replacement-feeding guidance.');
  }

  return {
    risk,
    risk_label: LABEL[risk],
    risk_color: COLOR[risk],
    immediate_action: immediate,
    whz,
    haz,
    waz,
    findings,
    recommendations,
  };
}

/**
 * Row shapes for the Supabase tables (see supabase/migrations).
 *
 * jsonb columns come back loosely typed from supabase-js (no generated types),
 * so callers still cast the raw result — these types describe the intended
 * contents so the rest of the app can rely on them.
 */

import type {
  DosageAnalysis,
  IngredientAnalysis,
  LegalMetrologyCompliance,
  PersonalFlag,
} from "./analysis";

export type ComplianceStatus = "compliant" | "non_compliant" | "partial";
export type ComplaintType = "compliance" | "ingredients";
export type ComplaintStatus = "drafted" | "submitted" | "redirected";

/** One entry in `scanned_products.healthier_alternatives`. */
export interface StoredAlternative {
  name: string;
  status?: IngredientAnalysis["safety_status"];
  alternatives: string[];
  tip: string;
}

/** `public.profiles` */
export interface Profile {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string;
}

/** `public.scanned_products` */
export interface ScannedProduct {
  id: string;
  user_id: string;
  product_name: string;
  brand: string | null;
  category: string | null;
  image_url: string | null;
  extracted_text: string | null;
  compliance_status: ComplianceStatus | null;
  compliance_details: LegalMetrologyCompliance;
  ingredient_analysis: IngredientAnalysis[];
  dosage_analysis: DosageAnalysis;
  personal_alerts: PersonalFlag[];
  healthier_alternatives: StoredAlternative[];
  overall_score: number | null;
  scanned_at: string;
}

/** `public.product_search` view — non-personal projection of scanned_products. */
export type ProductSearchRow = Omit<
  ScannedProduct,
  | "user_id"
  | "extracted_text"
  | "compliance_details"
  | "dosage_analysis"
  | "personal_alerts"
  | "healthier_alternatives"
>;

/** `public.user_health_profiles` */
export interface UserHealthProfile {
  id: string;
  user_id: string;
  allergies: string[];
  dietary_preferences: string[];
  health_conditions: string[];
  custom_avoid_ingredients: string[];
  created_at: string;
  updated_at: string;
}

/** `public.complaints` */
export interface Complaint {
  id: string;
  user_id: string;
  product_id: string;
  complaint_type: ComplaintType;
  status: ComplaintStatus;
  complaint_data: Record<string, unknown>;
  created_at: string;
}

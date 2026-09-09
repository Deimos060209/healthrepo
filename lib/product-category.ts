/**
 * Shared, client- and server-safe metadata for the broad regulatory category
 * that /api/analyze detects for every product (food / personal care / household
 * / baby / unknown).
 *
 * Every consumer of `detected_category` — the scan results screen, the history
 * detail screen, the complaint drafter, the PDF report and the safe-products
 * search — reads its regulator, portal list, label checklist, colour and score
 * threshold from here so the whole app stays consistent.
 *
 * Type-only import of the analysis types keeps this module free of any runtime
 * dependency (no Supabase client), so it is safe to import anywhere.
 */

import type {
  DetectedCategory,
  DetectedCategoryId,
  SafetyStatus,
} from "@/types/analysis";

export interface CategoryPortal {
  label: string;
  url: string;
  /** Optional helpline number to show next to the link. */
  phone?: string;
}

export type CategoryTone = "teal" | "purple" | "amber" | "blue" | "zinc";

export interface CategoryMeta {
  id: DetectedCategoryId;
  /** Short human label, e.g. "Personal Care". */
  label: string;
  emoji: string;
  tone: CategoryTone;
  /** Tailwind classes for a small pill badge (light + dark). */
  badgeClass: string;
  /** Border/text accent used on the category card. */
  accentClass: string;
  regulatoryBody: string;
  act: string;
  /** Where a consumer should complain about this kind of product. */
  portals: CategoryPortal[];
  /** Minimum overall_score for this category to be recommended as "safe". */
  scoreThreshold: number;
  /** Heading for the compliance section, tuned to the applicable rules. */
  complianceHeading: string;
  /** Category-appropriate one-liner for a harmful/banned ingredient. */
  riskPhrase: string;
}

const NCH: CategoryPortal = {
  label: "National Consumer Helpline",
  url: "https://consumerhelpline.gov.in",
  phone: "1915",
};
const FSSAI: CategoryPortal = {
  label: "FSSAI Food Safety Connect",
  url: "https://foscos.fssai.gov.in/consumergrievance",
  phone: "1800-11-4420",
};
const CDSCO: CategoryPortal = {
  label: "CDSCO Consumer Corner",
  url: "https://cdsco.gov.in/opencms/opencms/en/consumer-corner/",
};
const BIS: CategoryPortal = {
  label: "BIS complaint registration",
  url: "https://www.services.bis.gov.in/php/BIS_2.0/bisconnect/registration/complaint_registration",
};

export const CATEGORY_META: Record<DetectedCategoryId, CategoryMeta> = {
  food_and_beverages: {
    id: "food_and_beverages",
    label: "Food & Beverages",
    emoji: "🥗",
    tone: "teal",
    badgeClass:
      "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",
    accentClass: "border-teal-500/40",
    regulatoryBody: "FSSAI (Food Safety and Standards Authority of India)",
    act: "Food Safety and Standards Act, 2006",
    portals: [FSSAI, NCH],
    scoreThreshold: 75,
    complianceHeading: "Legal Metrology & FSSAI Compliance",
    riskPhrase: "This ingredient is not safe for consumption.",
  },
  personal_care: {
    id: "personal_care",
    label: "Personal Care",
    emoji: "🧴",
    tone: "purple",
    badgeClass:
      "bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300",
    accentClass: "border-purple-500/40",
    regulatoryBody: "CDSCO and BIS",
    act: "Drugs and Cosmetics Act, 1940 and BIS standards",
    portals: [CDSCO, NCH],
    scoreThreshold: 70,
    complianceHeading: "Cosmetic Labelling & Legal Metrology Compliance",
    riskPhrase:
      "This ingredient may cause skin irritation or long-term health effects through dermal absorption.",
  },
  household_cleaning: {
    id: "household_cleaning",
    label: "Household Product",
    emoji: "🧽",
    tone: "amber",
    badgeClass:
      "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
    accentClass: "border-amber-500/40",
    regulatoryBody: "BIS (Bureau of Indian Standards)",
    act: "Bureau of Indian Standards Act, 2016",
    portals: [NCH, BIS],
    scoreThreshold: 70,
    complianceHeading: "Safety Labelling & Legal Metrology Compliance",
    riskPhrase:
      "This chemical requires proper ventilation and protective equipment.",
  },
  baby_product_food: {
    id: "baby_product_food",
    label: "Baby Product (Food)",
    emoji: "🍼",
    tone: "blue",
    badgeClass:
      "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
    accentClass: "border-blue-500/40",
    regulatoryBody: "FSSAI — strictest standards for infant food",
    act: "Food Safety and Standards Act, 2006 (infant-food provisions)",
    portals: [FSSAI, CDSCO, NCH],
    scoreThreshold: 85,
    complianceHeading: "Baby-Product Labelling Compliance (strictest rules)",
    riskPhrase:
      "This ingredient does not meet the stricter safety standard for baby products.",
  },
  baby_product_care: {
    id: "baby_product_care",
    label: "Baby Product (Care)",
    emoji: "🍼",
    tone: "blue",
    badgeClass:
      "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
    accentClass: "border-blue-500/40",
    regulatoryBody: "CDSCO — strictest standards for baby care products",
    act: "Drugs and Cosmetics Act, 1940 (children's cosmetics provisions)",
    portals: [CDSCO, FSSAI, NCH],
    scoreThreshold: 85,
    complianceHeading: "Baby-Product Labelling Compliance (strictest rules)",
    riskPhrase:
      "This ingredient does not meet the stricter safety standard for baby products.",
  },
  unknown: {
    id: "unknown",
    label: "Uncategorised",
    emoji: "📦",
    tone: "zinc",
    badgeClass:
      "bg-zinc-200 text-zinc-700 dark:bg-white/10 dark:text-zinc-300",
    accentClass: "border-zinc-400/40",
    regulatoryBody: "Legal Metrology (Packaged Commodities) Rules, 2011",
    act: "Legal Metrology Act, 2009",
    portals: [NCH, FSSAI],
    scoreThreshold: 75,
    complianceHeading: "Legal Metrology Compliance",
    riskPhrase: "This ingredient has documented safety concerns.",
  },
};

/** The five real categories a user can pick from when correcting a detection. */
export const SELECTABLE_CATEGORIES: CategoryMeta[] = [
  CATEGORY_META.food_and_beverages,
  CATEGORY_META.personal_care,
  CATEGORY_META.household_cleaning,
  CATEGORY_META.baby_product_food,
  CATEGORY_META.baby_product_care,
];

/**
 * Resolve a `detected_category` payload to its metadata, preferring the
 * regulator / act the model actually reported when they are present.
 */
export function resolveCategory(
  dc: DetectedCategory | null | undefined,
): CategoryMeta {
  const base = CATEGORY_META[dc?.category ?? "unknown"] ?? CATEGORY_META.unknown;
  if (!dc) return base;
  return {
    ...base,
    regulatoryBody: dc.regulatory_body?.trim() || base.regulatoryBody,
    act: dc.applicable_act?.trim() || base.act,
  };
}

/** Minimum "safe" score for a category id — used by the safe-products surface. */
export function categoryScoreThreshold(
  id: DetectedCategoryId | string | null | undefined,
): number {
  if (!id) return 75;
  return (CATEGORY_META[id as DetectedCategoryId] ?? CATEGORY_META.unknown)
    .scoreThreshold;
}

/** Category-appropriate phrasing for a flagged ingredient in a report. */
export function ingredientRiskPhrase(
  id: DetectedCategoryId | null | undefined,
  status: SafetyStatus,
): string {
  const meta = CATEGORY_META[id ?? "unknown"] ?? CATEGORY_META.unknown;
  if (status === "safe" || status === "unknown") return "";
  return meta.riskPhrase;
}

/** Broad filter buckets for the safe-products search (Baby folds both baby ids). */
export const BROAD_CATEGORY_FILTERS: {
  key: string;
  label: string;
  emoji: string;
  match: DetectedCategoryId[];
}[] = [
  {
    key: "food_and_beverages",
    label: "Food & drink",
    emoji: "🥗",
    match: ["food_and_beverages"],
  },
  {
    key: "personal_care",
    label: "Personal care",
    emoji: "🧴",
    match: ["personal_care"],
  },
  {
    key: "household_cleaning",
    label: "Household",
    emoji: "🧽",
    match: ["household_cleaning"],
  },
  {
    key: "baby",
    label: "Baby",
    emoji: "🍼",
    match: ["baby_product_food", "baby_product_care"],
  },
];

/**
 * HealthRepo reference knowledge base.
 *
 * Plain-language, consumer-facing explanations of Indian packaging law
 * (Legal Metrology + FSSAI) and of banned / harmful food ingredients.
 * Every banned or harmful entry explains WHY it is a problem and WHAT it
 * does to the human body in language a non-scientist can follow.
 *
 * This data is fed verbatim into the /api/analyze system prompt, so keep it
 * accurate, sourced, and readable.
 */

import type {
  NutritionalConcernType,
  NutritionalConcernLevel,
  NutrientLevel,
} from "@/types/analysis";

// ============================================================================
// TYPES
// ============================================================================

export interface MandatoryDeclaration {
  rule_reference: string;
  requirement: string;
  details: string;
  penalty?: string;
}

export interface BannedIngredient {
  name: string;
  also_known_as: string[];
  e_code: string | null;
  banned_since: string;
  fssai_reference: string;
  found_in: string[];
  why_banned: string;
  health_effects_detailed: string;
  how_to_identify: string;
  severity: "critical";
}

export interface HarmfulAdditive {
  name: string;
  e_code: string | null;
  ins_code: string | null;
  category:
    | "preservative"
    | "color"
    | "sweetener"
    | "flavor enhancer"
    | "antioxidant"
    | "emulsifier"
    | "other";
  concern_level: "low" | "medium" | "high";
  legal_in_india: true;
  max_limit_in_india_mg_per_kg: number | null;
  health_effects_detailed: string;
  why_concerning: string;
  who_should_avoid: string;
  banned_or_restricted_in: string[];
  healthier_alternative: string;
  commonly_found_in: string[];
}

export interface ProductCategory {
  id: string;
  name: string;
  icon_emoji: string;
  examples: string[];
}

export interface FssaiAdditiveLimit {
  name: string;
  /** Alternate names the additive is printed under on Indian labels. */
  also_known_as: string[];
  e_code: string | null;
  ins_code: string | null;
  category:
    | "preservative"
    | "color"
    | "sweetener"
    | "antioxidant"
    | "emulsifier"
    | "acidity_regulator"
    | "flavor_enhancer";
  /**
   * Headline FSSAI maximum, in mg per kg (solids) or mg per litre (liquids) of
   * the finished product. `null` means the additive is permitted at GMP (Good
   * Manufacturing Practice) level — there is no fixed number, but visibly heavy
   * use is still a violation.
   */
  fssai_max_limit_mg_per_kg: number | null;
  fssai_regulation_reference: string;
  /** Product categories (PRODUCT_CATEGORIES ids where possible) the headline limit covers. */
  applies_to: string[];
  /** Category-specific limits that differ from the headline number. */
  special_limits: { category: string; limit_mg_per_kg: number }[];
  /** Plain-language health effect of going over the limit. */
  what_happens_above_limit: string;
  /** How a consumer can roughly tell the limit may have been exceeded. */
  how_to_check: string;
  /** Acceptable Daily Intake, mg per kg of body weight per day (where one exists). */
  adi_mg_per_kg_body_weight?: number;
  /** Worked example of the ADI against a typical serving of this kind of product. */
  example_calculation?: string;
}

export interface HealthierAlternative {
  alternatives: string[];
  explanation: string;
  what_to_look_for_on_label: string;
}

// ============================================================================
// 1. LEGAL METROLOGY COMPLIANCE RULES
// ============================================================================

export const LEGAL_METROLOGY_RULES = {
  /**
   * A) All 11 declarations mandated under Rule 6 of the Legal Metrology
   * (Packaged Commodities) Rules, 2011.
   */
  MANDATORY_DECLARATIONS: {
    manufacturer_info: {
      rule_reference: "Rule 6(1)(a)",
      requirement:
        "Full name and complete postal address including PIN code of manufacturer/packer/importer",
      details:
        "For imported goods, Indian importer's name and address MUST appear even if foreign manufacturer details present. If brand owner appears as marketer, brand owner is responsible for violations. Just a brand name with city is NOT enough — full address with PIN code required.",
      penalty: "Up to ₹25,000 first offence, ₹1,00,000 repeat",
    },
    generic_name: {
      rule_reference: "Rule 6(1)(b)",
      requirement:
        "Common or generic name of the commodity — not just brand name",
      details:
        "Must describe what the product actually IS. E.g. 'Refined Sunflower Oil' not just 'Sunshine'. 'Wheat Biscuits' not just 'ParleG'. Brand name alone = violation.",
    },
    net_quantity: {
      rule_reference: "Rule 6(1)(c)",
      requirement: "Net quantity in standard metric units",
      details:
        "Solids: weight in g or kg. Liquids: volume in ml or l. Must be NET (excluding packaging weight). WRONG formats: '500 GMS', '500 gm', '500 Grams' — correct: '500 g'. Non-standard abbreviations are a violation.",
    },
    manufacture_date: {
      rule_reference: "Rule 6(1)(d)",
      requirement: "Month and year of manufacture or packing",
      details:
        "Format: 'Mfg: MM/YYYY' or spelled out like 'Manufactured: March 2026'. Day optional.",
    },
    best_before_use_by: {
      rule_reference: "Rule 6(1)(e)",
      requirement:
        "Best Before or Use By date for any product that can become unfit for use over time",
      details:
        "Best Before = quality may decline after this date. Use By = unsafe after this date, do not consume. Format: MM/YYYY or DD/MM/YYYY. Products with shelf life of 3 months or less MUST include full date (day/month/year).",
    },
    mrp: {
      rule_reference: "Rule 6(1)(f)",
      requirement: "MRP ₹XX.XX (Incl. of all taxes)",
      details:
        "MUST include phrase '(Incl. of all taxes)' or '(Inclusive of all taxes)'. Rupee symbol ₹ or 'Rs.' must precede amount. Selling above MRP = cognizable offence with imprisonment up to 1 year. If MRP revised after GST change, original MRP must remain visible.",
    },
    unit_sale_price: {
      rule_reference: "Rule 6(1)(g)",
      requirement:
        "Price per standard unit (₹XX.XX per g/kg/ml/l) rounded to 2 decimal places",
      details:
        "Allows consumers to compare value across different package sizes. Exemptions: packages under 100 sq cm area, MRP ₹35 or less, wholesale packages. Font must be at least 50% of MRP font size.",
    },
    consumer_care: {
      rule_reference: "Rule 6(1)(h)",
      requirement:
        "Consumer care details — company name, full address, WORKING phone number, AND email address",
      details:
        "ALL THREE needed: address + phone + email. Non-functional phone = violation. Missing email = violation. This is the MOST commonly incomplete declaration on Indian products.",
    },
    country_of_origin: {
      rule_reference: "Rule 6(1)(i)",
      requirement:
        "Country of origin for imported products in 'Made in [Country]' format",
      details:
        "Mandatory for all imported goods. Domestic products not legally required but many add voluntarily.",
    },
    fssai_license: {
      rule_reference:
        "FSSAI Regulation (dual compliance with LMPC for food products)",
      requirement: "14-digit FSSAI licence or registration number",
      details:
        "Mandatory for ALL food and beverage products. FSSAI logo not mandatory but the 14-digit number IS. Must be clearly visible.",
    },
    dimensions_if_applicable: {
      rule_reference: "Rule 6(1)(j)",
      requirement: "Relevant dimensions for applicable products",
      details:
        "Textiles: length × width. Cables: length. Sheets: full dimensions. Required in addition to weight/volume where relevant.",
    },
  } as Record<string, MandatoryDeclaration>,

  /** B) Rule 7 — letter and numeral size. */
  FONT_SIZE_RULES: {
    general_minimum:
      "All declarations: minimum 1mm letter height. If blown/formed/molded/embossed/perforated: minimum 2mm.",
    width_rule:
      "Letter/numeral width must be at least 1/3 of its height (except numeral '1' and letters i, I, l).",
    numeral_height_table: [
      {
        package_surface_area: "Up to 100 sq cm",
        min_numeral_height_mm: 1,
        example: "Small sachet, candy wrapper",
      },
      {
        package_surface_area: "100 to 200 sq cm",
        min_numeral_height_mm: 2,
        example: "Small box, pouch",
      },
      {
        package_surface_area: "200 to 500 sq cm",
        min_numeral_height_mm: 4,
        example: "Standard box, bottle",
      },
      {
        package_surface_area: "Above 500 sq cm",
        min_numeral_height_mm: 6,
        example: "Large box, container",
      },
    ],
    mrp_specific:
      "MRP numerals must follow the table above. Printing MRP in low-contrast color, behind a fold, or obscured by design elements is NON-COMPLIANT even if font size technically meets minimum.",
    usp_font: "Unit Sale Price font must be at least 50% of MRP font size.",
    legibility:
      "Text must be clearly legible against background. Low contrast between text and background color = non-compliant.",
  },

  /** C) Which part of the pack the declarations must sit on. */
  PRINCIPAL_DISPLAY_PANEL_RULES: {
    rectangular:
      "One entire side of the package = principal display panel (PDP)",
    cylindrical: "40% of total surface area = PDP",
    other_shapes: "40% of total surface area = PDP",
    excluded_from_area:
      "Top, bottom, flange at top/bottom of cans, shoulders and neck of bottles/jars NOT included in PDP area calculation",
    small_packages:
      "Packages ≤ 5 cubic cm may use a card or tape affixed firmly as PDP",
    key_rule:
      "ALL mandatory declarations must appear on the principal display panel",
    common_violation:
      "Hiding mandatory info on bottom, inside flaps, or under shrink wrap = violation even if technically present",
  },

  /** D) Extra requirements FSSAI stacks on top for food products. */
  FSSAI_FOOD_SPECIFIC_RULES: {
    ingredients_list:
      "Complete ingredients in DESCENDING order of composition by weight at time of manufacture",
    nutritional_info:
      "Mandatory table: energy (kcal), protein (g), carbohydrate (g), total sugar (g), added sugar (g), total fat (g), saturated fat (g), trans fat (g), sodium (mg) — per 100g/ml AND per serving. Also % contribution to RDA.",
    allergen_declaration:
      "MUST declare: cereals containing gluten, crustaceans, eggs, fish, peanuts, soybeans, milk/lactose, tree nuts, sulphites (>10mg/kg). Format: 'Contains: [allergens]' or bold in ingredients list.",
    veg_nonveg_symbol:
      "Green circle in green square = vegetarian. Brown/maroon circle in brown/maroon square = non-vegetarian. MANDATORY on ALL food packages. Missing = violation.",
    fruit_content_percentage:
      "Fruit-based beverages must declare % of fruit/juice content",
    health_claims:
      "No health/nutrition claims without FSSAI substantiation and approval",
  },

  /** E) What it costs the seller/maker to get this wrong. */
  PENALTIES: {
    first_offence_lmpc: "Fine up to ₹25,000",
    repeat_offence_lmpc: "Fine up to ₹1,00,000",
    selling_above_mrp:
      "Cognizable offence — fine + imprisonment up to 1 year",
    goods_seizure:
      "Non-compliant stock can be seized on spot during inspection",
    fssai_penalty:
      "Separate penalty under Food Safety & Standards Act 2006 — up to ₹5,00,000",
    director_liability:
      "Individual directors and managers can be personally prosecuted",
  },

  /** F) The violations inspectors and consumer courts see most often. */
  COMMON_VIOLATIONS: [
    "Incomplete consumer care details: an address and a phone number are printed, but there is no email — or the phone number does not connect. The law needs all three so you can actually reach the company when a product is defective.",
    "MRP printed without the words '(Incl. of all taxes)'. Without that phrase a shopkeeper can claim taxes are 'extra' and charge you more than the sticker price.",
    "Only a brand name and a city, with no full postal address or PIN code. If something goes wrong you cannot send a legal notice or track down who is responsible.",
    "Net quantity written as '500 gm', '500 Grams' or '500 GMS' instead of '500 g'. Non-standard units are used to make short-weighing harder to spot and to dodge unit-price comparison.",
    "MRP or manufacture date hidden inside a fold, on the bottom of the pack, or under the shrink wrap. Mandatory information has to be on the main front panel where you can see it before buying.",
    "MRP printed in pale ink, embossed clear-on-clear, or overprinted on a busy design so it cannot be read. This is non-compliant even if the font size technically meets the minimum.",
    "No 'best before' or 'use by' date on a perishable product, or only a manufacture date. You cannot tell if the food is still safe.",
    "Missing veg / non-veg symbol (the green or brown dot). It must appear on every packaged food; without it vegetarians and many religious consumers cannot make an informed choice.",
    "FSSAI number missing, fewer than 14 digits, or printed as an unreadable blur. A food product with no valid FSSAI licence number should not be on the shelf.",
    "No unit sale price (₹ per kg / per litre) on packs that are not exempt, so you cannot compare a 'value pack' against a small pack and see which is actually cheaper.",
    "Nutritional panel missing the 'added sugar', 'saturated fat' or 'trans fat' rows, which are exactly the numbers that matter most for health.",
    "Allergens (milk, peanuts, soya, gluten, tree nuts) buried in tiny text in the ingredient list with no clear 'Contains:' statement — dangerous for people with allergies.",
    "Imported product showing only the foreign manufacturer, with no Indian importer name, address or 'Made in [Country]' line.",
    "A revised MRP sticker pasted over the original after a price or GST change, fully covering the old price instead of leaving it visible.",
  ],
};

// ============================================================================
// 2. BANNED INGREDIENTS
// ============================================================================
// Every entry is "critical". why_banned and health_effects_detailed are written
// for a normal consumer, not a chemist.

export const BANNED_INGREDIENTS: BannedIngredient[] = [
  {
    name: "Potassium Bromate",
    also_known_as: ["Potassium bromate", "KBrO3", "Bromated flour (when used to treat flour)", "E924"],
    e_code: "E924",
    banned_since: "2016",
    fssai_reference:
      "Removed from the list of permitted flour treatment agents by FSSAI in 2016 (amendment to the Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011).",
    found_in: ["bread", "pav", "buns", "bakery products", "pizza dough"],
    why_banned:
      "Potassium bromate was used in bread and bakery products to make dough rise higher and give bread a white, fluffy appearance. FSSAI banned it in 2016 after the International Agency for Research on Cancer (IARC) classified it as a Group 2B carcinogen — meaning it probably causes cancer in humans. Studies showed it causes kidney tumors and thyroid tumors in animals. Many countries including EU, UK, Canada, Brazil, and China banned it years before India did.",
    health_effects_detailed:
      "Can cause kidney damage and kidney tumors. May cause thyroid cancer. Damages DNA in cells (genotoxic). Children and people who eat bread daily are most at risk because the chemical accumulates over time. Symptoms of exposure include nausea, diarrhea, and abdominal pain.",
    how_to_identify:
      "Bread that is unusually white, very springy, with a fine even crumb and that stays soft for days may have been treated with it. It is rarely printed on labels since the ban, so buy from bakeries that state 'bromate-free' / 'KBrO3-free' and prefer wholemeal or sourdough loaves.",
    severity: "critical",
  },
  {
    name: "Brominated Vegetable Oil",
    also_known_as: ["BVO", "Brominated vegetable oil", "Brominated soybean oil", "E443"],
    e_code: "E443",
    banned_since: "restricted in India; US FDA revoked authorization in 2024",
    fssai_reference:
      "Not listed among the emulsifiers/stabilisers permitted for beverages under the Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011.",
    found_in: ["citrus-flavored soft drinks", "energy drinks", "sports drinks"],
    why_banned:
      "BVO is vegetable oil modified with bromine, used to keep citrus flavoring from separating in soft drinks. Bromine is a toxic element that builds up in body fat over years. The US FDA revoked its authorization in 2024 after studies showed organ damage. India and many countries have banned or restricted it.",
    health_effects_detailed:
      "Bromine accumulates in fat tissue and is very slow to leave the body. Causes damage to the nervous system — memory loss, tremors, fatigue, and impaired balance. Damages the thyroid gland, leading to hormonal imbalances. Can cause skin lesions. Animal studies showed heart damage at high levels. Children and pregnant women are especially vulnerable.",
    how_to_identify:
      "Cloudy citrus sodas where the flavour stays evenly mixed instead of settling out. Check the ingredients for 'brominated vegetable oil' or 'BVO'. Reformulated brands use glycerol ester of wood rosin (ester gum, E445) or sucrose acetate isobutyrate (E444) instead.",
    severity: "critical",
  },
  {
    name: "Metanil Yellow",
    also_known_as: ["Metanil yellow", "Acid Yellow 36", "Tridine", "Sodium salt of metanilic acid azo dye"],
    e_code: null,
    banned_since: "never permitted for food use; ongoing enforcement",
    fssai_reference:
      "Non-permitted colour under the Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011; use is an adulteration offence under the FSS Act, 2006. FSSAI's DART (Detect Adulteration with Rapid Test) manual gives a home spot-test.",
    found_in: ["adulterated turmeric", "dal/pulses", "sweets/mithai", "besan", "street food"],
    why_banned:
      "Metanil Yellow is a cheap industrial dye meant for coloring textiles and leather — it was NEVER approved for food use. It is illegally added to turmeric, dal, sweets, and street food to make them look more vibrant yellow. FSSAI has conducted multiple raids and crackdowns.",
    health_effects_detailed:
      "Highly toxic to the liver and kidneys. Classified as a carcinogen. Causes damage to the stomach lining and intestines. Can cause allergic reactions, nausea, and vomiting. Long-term exposure linked to tumors of the liver and bladder. Particularly dangerous for children.",
    how_to_identify:
      "Suspiciously bright, uniform lemon-yellow powder or dal. DART test: stir a spoon of the sample in water and add a few drops of hydrochloric acid — a pink or magenta colour means metanil yellow. Pure turmeric stays yellow.",
    severity: "critical",
  },
  {
    name: "Rhodamine B",
    also_known_as: ["Rhodamine B", "Basic Violet 10", "C.I. 45170", "D&C Red No. 19 (former cosmetic name)"],
    e_code: null,
    banned_since: "never permitted for food use; ongoing enforcement",
    fssai_reference:
      "Non-permitted colour under the FSS (Food Products Standards and Food Additives) Regulations, 2011. FSSAI 2024 advisory on coloured cotton candy; several states have prohibited its sale.",
    found_in: ["cotton candy/candy floss", "colored sweets", "red chilli powder (adulterated)"],
    why_banned:
      "Rhodamine B is a bright pink/red industrial dye used in textiles and laboratory work. It is illegally added to food to give an attractive pink or red color, especially in sweets and cotton candy.",
    health_effects_detailed:
      "Toxic to the liver, kidneys, and reproductive system. Irritates skin, eyes, and respiratory tract. Classified as a potential carcinogen. Can cause permanent damage to the nervous system. Particularly harmful to children who are attracted to bright-colored foods.",
    how_to_identify:
      "Cotton candy, 'red' sweets or watermelon flesh that bleed vivid pink when wiped with a wet white tissue or cotton swab. Genuine permitted colour does not run that strongly.",
    severity: "critical",
  },
  {
    name: "Sudan Dyes (I, II, III, IV)",
    also_known_as: ["Sudan I", "Sudan II", "Sudan III", "Sudan IV", "Scarlet Red", "Solvent Red 23/24", "CI Solvent Yellow 14"],
    e_code: null,
    banned_since: "never permitted for food use; ongoing enforcement",
    fssai_reference:
      "Non-permitted colours under the FSS (Food Products Standards and Food Additives) Regulations, 2011; flagged internationally through the EU RASFF system since 2003.",
    found_in: ["chilli powder", "cayenne pepper", "paprika", "spice mixes", "tandoori masala"],
    why_banned:
      "Sudan dyes are industrial dyes used for coloring waxes, plastics, and shoe polish. They are illegally added to chilli powder and spices to make them appear more vibrant red. Classified as Category 3 carcinogens by IARC.",
    health_effects_detailed:
      "Cause liver and bladder tumors in animals. Damage DNA and cell structure (genotoxic and mutagenic). Can cause severe allergic reactions. Long-term consumption increases cancer risk significantly. No safe level of consumption.",
    how_to_identify:
      "Chilli or paprika powder with an unnaturally deep, oily red that stains fingers and does not fade with age. Genuine red chilli powder is more orange-red and dulls over time. A lab test is the only certain check.",
    severity: "critical",
  },
  {
    name: "Calcium Carbide",
    also_known_as: ["Calcium carbide", "Carbide", "CaC2", "'Masala' (street term for carbide packets)"],
    e_code: null,
    banned_since: "prohibited for fruit ripening since 2011; ongoing",
    fssai_reference:
      "Regulation 2.3.5 of the FSS (Prohibition and Restrictions on Sales) Regulations, 2011 — 'No person shall sell or offer for sale fruits which have been artificially ripened by use of acetylene gas known as carbide gas.' Ethylene gas up to 100 ppm is the permitted alternative.",
    found_in: ["artificially ripened mangoes", "bananas", "papayas", "other fruits"],
    why_banned:
      "Calcium carbide is a chemical used to artificially ripen fruits quickly (in 1-2 days instead of naturally). When it reacts with moisture, it releases acetylene gas (the same gas used in welding torches) and traces of arsenic and phosphorus. FSSAI allows ethylene gas as a safe alternative up to 100 ppm.",
    health_effects_detailed:
      "Releases arsenic and phosphorus which are both toxic. Causes headache, dizziness, mood disturbances, sleepiness, and mental confusion. Damages the neurological system. Irritates mouth, throat, and stomach. Can cause seizures in severe cases. Especially dangerous for pregnant women and children.",
    how_to_identify:
      "Uniformly yellow/orange mangoes with green patches near the stalk, black soot-like specks on the skin, a faint garlic-like smell, and flesh that is sour or still starchy inside. Carbide-ripened fruit spoils within a day or two and may leave white residue when soaked in water.",
    severity: "critical",
  },
  {
    name: "Formalin (Formaldehyde)",
    also_known_as: ["Formalin", "Formaldehyde solution", "Methanal", "Methylene oxide"],
    e_code: null,
    banned_since: "never permitted in food; ongoing (large seizures across coastal states from 2018)",
    fssai_reference:
      "Non-permitted preservative; use in food is adulteration under the FSS Act, 2006. FSSAI approved rapid formaldehyde test strips for fish in 2018-2019.",
    found_in: ["fish (to prevent rotting)", "milk (to extend shelf life)", "fruits"],
    why_banned:
      "Formalin is a preservative chemical normally used to preserve dead bodies and biological specimens. It is illegally used to preserve fish, milk, and fruits to increase shelf life. Classified as a Group 1 carcinogen by IARC — confirmed to cause cancer in humans.",
    health_effects_detailed:
      "Confirmed human carcinogen — causes nasopharyngeal cancer (nose/throat cancer) and leukemia. Causes severe irritation to eyes, nose, throat, and skin. Triggers asthma attacks. Causes nausea, vomiting, and abdominal cramps. Long-term exposure damages liver and kidneys. Can be fatal in large quantities.",
    how_to_identify:
      "Fish that looks unnaturally fresh with stiff flesh, clear eyes and bright gills after days on ice, no fishy smell (or a sharp chemical/bleach smell), and no flies around the stall. FSSAI formaldehyde test strips give a colour change.",
    severity: "critical",
  },
  {
    name: "Oxytocin",
    also_known_as: ["Oxytocin", "Oxytocin injection", "Pitocin", "'Doodh badhao' injection (street term)"],
    e_code: null,
    banned_since: "private manufacture and retail sale banned in 2018",
    fssai_reference:
      "Ministry of Health notification S.O. 2074(E), 2018 restricting manufacture and sale to a single public-sector unit; residues in milk/produce are an FSS adulteration concern.",
    found_in: ["milk", "paneer", "vegetables (injected to increase size)"],
    why_banned:
      "Oxytocin is a hormone that was illegally injected into dairy cattle and vegetables to increase milk production and make vegetables look bigger. The Indian government banned its private sale and manufacturing in 2018.",
    health_effects_detailed:
      "In cattle, causes severe pain and reduces lifespan. Oxytocin residues in milk can affect human hormonal balance. Linked to early puberty in children. Can cause hormonal imbalances, especially in women. May affect reproductive health.",
    how_to_identify:
      "Very large, uniformly sized bottle gourd, pumpkin, brinjal or cucumber that taste watery and bland and rot quickly. There is no home test for hormone residue in milk — buy from trusted dairies.",
    severity: "critical",
  },
  {
    name: "Malachite Green",
    also_known_as: ["Malachite green", "Aniline green", "Basic Green 4", "Victoria Green B", "Leucomalachite green (its residue form)"],
    e_code: null,
    banned_since: "never permitted for food use; ongoing (repeated EU RASFF alerts on Indian seafood)",
    fssai_reference:
      "Non-permitted colour/antifungal under the FSS (Food Products Standards and Food Additives) Regulations, 2011; monitored under the Export Inspection Council residue-control plan for fish.",
    found_in: ["farmed fish", "prawns/shrimp", "aquaculture products"],
    why_banned:
      "Malachite Green is an industrial dye used for dyeing silk, leather, and paper. It is illegally used in fish farming to prevent fungal infections in fish. It persists in fish flesh for months.",
    health_effects_detailed:
      "Classified as a potential carcinogen. Causes liver tumors. Genotoxic and mutagenic (damages DNA). Affects the immune system. May cause reproductive problems. Residues remain in fish even after cooking.",
    how_to_identify:
      "Farmed fish (rohu, katla, pangasius) or prawns with a greenish-blue tint on the gills, fins or belly, or blue-green tinted water and ice at the stall.",
    severity: "critical",
  },
  {
    name: "Lead Chromate",
    also_known_as: ["Lead chromate", "Chrome yellow", "Pigment Yellow 34", "PbCrO4"],
    e_code: null,
    banned_since: "never permitted for food use; ongoing (2019 Stanford/IndiaSpend turmeric study)",
    fssai_reference:
      "Non-permitted colour; lead and chromium are capped under the FSS (Contaminants, Toxins and Residues) Regulations, 2011.",
    found_in: ["adulterated turmeric", "adulterated dal/pulses", "mixed spice powders"],
    why_banned:
      "Lead chromate is a toxic yellow pigment used to make turmeric and dal appear more yellow and vibrant. Both lead and chromium are toxic heavy metals.",
    health_effects_detailed:
      "Lead is a cumulative toxin — it builds up in bones and organs. Causes brain damage especially in children (reduced IQ, learning disabilities). Damages kidneys, liver, and reproductive system. Chromium VI is carcinogenic. Can cause anemia, weakness, and neurological problems. No safe level of lead exposure for children.",
    how_to_identify:
      "Turmeric root or powder with a bright, almost neon yellow that leaves a heavy smear. Drop a piece of raw turmeric in a glass of water — bright yellow streaks trailing down suggest added pigment; natural turmeric colours the water only faintly.",
    severity: "critical",
  },
  {
    name: "Copper Sulphate",
    also_known_as: ["Copper sulphate", "Copper sulfate", "Blue vitriol", "Neela thotha", "CuSO4"],
    e_code: null,
    banned_since: "not permitted to colour or coat produce; ongoing",
    fssai_reference:
      "Non-permitted for surface treatment of produce; copper is capped at 30 mg/kg for most foods under the FSS (Contaminants, Toxins and Residues) Regulations, 2011.",
    found_in: ["green vegetables (to enhance color)", "green peas"],
    why_banned:
      "Copper sulphate is an industrial chemical used as a pesticide and in copper plating. It is illegally used to make vegetables appear fresh and green.",
    health_effects_detailed:
      "Causes severe vomiting, diarrhea, and abdominal pain. Damages the liver and kidneys. Can cause hemolytic anemia (destruction of red blood cells). Large doses can be fatal. Causes burning sensation in mouth and throat.",
    how_to_identify:
      "Bitter gourd, green chillies, peas or okra with an unusually deep, glossy, uniform green. Rub the surface with a wet cotton swab — a bluish tint on the swab points to copper sulphate.",
    severity: "critical",
  },
  {
    name: "Argemone Seeds / Oil",
    also_known_as: ["Argemone mexicana", "Mexican prickly poppy", "Satyanashi", "Kateli", "Prickly poppy oil"],
    e_code: null,
    banned_since: "never permitted; ongoing (major Epidemic Dropsy outbreak, Delhi 1998)",
    fssai_reference:
      "FSS (Prohibition and Restrictions on Sales) Regulations, 2011 — mustard oil must be free from argemone oil; the nitric acid test is prescribed for detection.",
    found_in: ["adulterated mustard oil", "contaminated mustard seeds"],
    why_banned:
      "Argemone mexicana is a toxic weed whose seeds look similar to mustard seeds. Its oil is mixed with mustard oil as a cheap adulterant. This caused the deadly 'Epidemic Dropsy' outbreaks in India.",
    health_effects_detailed:
      "Causes Epidemic Dropsy — a clinical condition with swelling of legs, skin rashes, and loss of vision. Contains toxic alkaloids sanguinarine and dihydrosanguinarine. Causes glaucoma and can lead to permanent blindness. Damages the liver. Can be fatal.",
    how_to_identify:
      "Nitric acid test: shake mustard oil with an equal volume of concentrated nitric acid — a red-brown or orange colour in the acid layer means argemone oil. Argemone seeds are rounder, blackish and rough; mustard seeds are smooth and reddish-brown.",
    severity: "critical",
  },
  {
    name: "Toluene in Food Packaging",
    also_known_as: ["Toluene", "Toluol", "Methylbenzene", "Phenylmethane"],
    e_code: null,
    banned_since: "restricted in food-contact printing inks; ongoing",
    fssai_reference:
      "FSS (Packaging) Regulations, 2018 — printing inks shall not come into direct contact with food and must conform to IS 15495; toluene-based inks are discouraged.",
    found_in: ["food packaging with printed inks"],
    why_banned:
      "Toluene is a toxic solvent used in printing inks on food packaging. It can leach from packaging into food. FSSAI banned its use in food-contact packaging.",
    health_effects_detailed:
      "Causes liver and kidney damage. Affects the central nervous system — dizziness, headaches, confusion. Long-term exposure causes neurological damage. Harmful to developing fetuses.",
    how_to_identify:
      "A strong solvent or 'petrol' smell when a packet is first opened, or printing on the inner surface of a wrapper that touches the food. Prefer packs with a separate food-grade inner liner.",
    severity: "critical",
  },
  {
    name: "Stapler Pins in Tea Bags",
    also_known_as: ["Staple pin", "Tea bag staple", "Metal tag pin"],
    e_code: null,
    banned_since: "2018",
    fssai_reference:
      "FSSAI direction dated 22 December 2017, effective January 2018 — tea bags shall not contain staple pins.",
    found_in: ["tea bags with metallic staples"],
    why_banned:
      "FSSAI banned stapler pins in tea bags from January 2018. Metallic pins can come loose during brewing and cause injuries. The metal may also contain or leach carcinogenic substances.",
    health_effects_detailed:
      "Choking hazard. Oral/internal injuries if swallowed. Metallic contamination of tea. Pins may contain harmful metals that leach into hot tea.",
    how_to_identify:
      "Check the tea bag tag — compliant bags use a knot, heat-seal, or paper/string crimp. Any metal staple holding the string or tag is non-compliant.",
    severity: "critical",
  },
  {
    name: "Titanium Dioxide",
    also_known_as: ["Titanium dioxide", "TiO2", "CI 77891", "Pigment White 6", "INS 171", "E171"],
    e_code: "E171",
    banned_since: "EU ban 2022; under review in India",
    fssai_reference:
      "Currently listed as permitted colour INS 171 in some FSS food-additive tables; FSSAI review initiated after the EFSA 2021 safety opinion and EU Regulation 2022/63.",
    found_in: ["white-coated candy", "chewing gum", "icing", "sauces", "coffee creamer"],
    why_banned:
      "Proposed ban in India following EU ban in 2022. Used as a whitening agent. The European Food Safety Authority found it can damage DNA (genotoxicity) and is no longer considered safe.",
    health_effects_detailed:
      "Potential genotoxicity — may damage DNA in cells. Nanoparticles can accumulate in organs. May cause inflammation in the gut. Crosses biological barriers. EU banned it completely for food use in 2022.",
    how_to_identify:
      "Very white, opaque coatings on chewing gum, mints, white chocolate, icing and sugar-shell 'dragees'. The label may say 'titanium dioxide', 'INS 171' or 'colour (171)'. A bright matte-white shell is the visual clue.",
    severity: "critical",
  },
];

// ============================================================================
// 3. HARMFUL BUT LEGAL ADDITIVES
// ============================================================================
// Legal in India within limits, but worth being cautious about. Every
// health_effects_detailed is 2-4 plain-language sentences.

export const HARMFUL_ADDITIVES: HarmfulAdditive[] = [
  {
    name: "Sodium Benzoate",
    e_code: "E211",
    ins_code: "INS 211",
    category: "preservative",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: 120,
    health_effects_detailed:
      "Sodium benzoate stops mould, yeast and bacteria from growing in acidic foods and drinks. Its biggest problem is that when it sits in the same product as vitamin C (ascorbic acid), the two can slowly react to form benzene, a chemical that causes leukaemia in humans. On its own it has been linked in some studies to increased hyperactivity and restlessness in children. It can also worsen asthma and bring on hives in people who are sensitive to it.",
    why_concerning:
      "Can form cancer-causing benzene when combined with vitamin C; linked to hyperactivity in children and to asthma and hives in sensitive people. The permitted limit varies a lot by food category.",
    who_should_avoid:
      "Children (especially those with ADHD or hyperactivity), people with asthma, eczema or aspirin/salicylate sensitivity, and anyone regularly drinking products that also list vitamin C or citric acid.",
    banned_or_restricted_in: [
      "Not banned, but tightly capped in the EU (E211) and kept under review",
      "Reformulated out of many soft drinks worldwide after benzene recalls",
    ],
    healthier_alternative:
      "Products preserved by refrigeration, natural acidity (vinegar, lemon juice) or potassium sorbate; freshly squeezed juice with no added preservative.",
    commonly_found_in: [
      "soft drinks",
      "fruit juices and squashes",
      "pickles",
      "sauces and ketchup",
      "jams",
      "salad dressings",
    ],
  },
  {
    name: "Potassium Sorbate",
    e_code: "E202",
    ins_code: "INS 202",
    category: "preservative",
    concern_level: "low",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: 1000,
    health_effects_detailed:
      "Potassium sorbate is one of the gentler preservatives, used to stop mould and yeast in cheese, dried fruit and baked goods. Most people digest it like any other fatty acid and it leaves the body easily. In large or frequent amounts it can cause mild skin, lip or mouth irritation and, rarely, an allergic rash. Some laboratory studies have seen minor DNA damage to white blood cells at very high doses, but this is not considered a real risk at food levels.",
    why_concerning:
      "Low concern overall. The main reasons to note it are possible mild irritation in sensitive people and the fact that its presence signals a heavily processed product.",
    who_should_avoid:
      "People with a known sorbate sensitivity or chronic hives; otherwise no specific high-risk group.",
    banned_or_restricted_in: ["Permitted essentially worldwide with no bans"],
    healthier_alternative:
      "Fresh or refrigerated versions of the same food; products with a shorter shelf life preserved by natural acids alone.",
    commonly_found_in: [
      "cheese",
      "yoghurt drinks",
      "dried fruit",
      "baked goods",
      "wine",
      "packaged bread",
    ],
  },
  {
    name: "Sodium Nitrite",
    e_code: "E250",
    ins_code: "INS 250",
    category: "preservative",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: 200,
    health_effects_detailed:
      "Sodium nitrite is a curing salt that keeps processed meat pink and blocks the growth of the deadly botulism bacterium. The problem is that when nitrite meets the protein building-blocks in meat under high heat — frying bacon, grilling sausages — it forms nitrosamines, which are among the most potent cancer-causing chemicals known. Regular processed-meat eating is linked to bowel and stomach cancer, and the WHO rates processed meat as a Group 1 (definite) carcinogen partly for this reason. Very large doses can also stop the blood carrying oxygen properly, turning the skin blue, which is especially dangerous for babies.",
    why_concerning:
      "Forms carcinogenic nitrosamines when cooked at high heat; a major contributor to the established processed-meat and bowel-cancer link; acute oxygen-carrying risk for infants.",
    who_should_avoid:
      "Infants and young children, pregnant women, anyone advised to lower bowel-cancer risk, and frequent eaters of bacon, ham and sausages.",
    banned_or_restricted_in: [
      "Not banned; the EU cut maximum added levels in 2023",
      "Tightly capped in every country that permits it",
    ],
    healthier_alternative:
      "Fresh unprocessed meat; 'uncured' / 'no added nitrite' bacon and ham (note celery-juice versions still contain natural nitrate); poultry, fish, or beans and lentils for sandwiches.",
    commonly_found_in: [
      "bacon",
      "ham",
      "salami and cured sausages",
      "hot dogs / frankfurters",
      "tinned meat",
      "some smoked fish",
    ],
  },
  {
    name: "Sodium Nitrate",
    e_code: "E251",
    ins_code: "INS 251",
    category: "preservative",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: 500,
    health_effects_detailed:
      "Sodium nitrate is a slower-acting curing agent that bacteria and the body steadily convert into sodium nitrite, so it carries the same downstream risk of forming cancer-causing nitrosamines in cooked processed meat. It also adds to the total 'nitrate load' of the diet; nitrate from vegetables comes packaged with protective antioxidants, but nitrate added to meat does not. In large amounts it can reduce the blood's ability to carry oxygen, which is a particular danger for infants.",
    why_concerning:
      "Turns into nitrite inside the body, so it shares the nitrosamine and cancer concerns and the infant oxygen-carrying risk.",
    who_should_avoid:
      "Infants, pregnant women, frequent processed-meat eaters, and people managing bowel-cancer risk.",
    banned_or_restricted_in: [
      "Not banned; capped for specific products (mainly cured meats and some cheeses) in the EU and India",
    ],
    healthier_alternative:
      "Fresh meat and cheese with no added nitrate; refrigeration or freezing instead of curing.",
    commonly_found_in: [
      "dry-cured hams and salami",
      "some traditional cheeses (Gouda, Edam, Grana)",
      "cured and pickled meats",
      "pâtés",
    ],
  },
  {
    name: "Propyl Paraben",
    e_code: "E216 (propyl paraben) / E217 (sodium salt)",
    ins_code: "INS 216 / INS 217",
    category: "preservative",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: null,
    health_effects_detailed:
      "Propyl paraben is a preservative from the paraben family used to stop mould and bacteria in baked goods, coatings and supplements. It is an endocrine (hormone) disruptor: it can weakly mimic the female hormone oestrogen, and animal studies found it lowered sperm counts and testosterone at doses once considered safe. Because of this the EU removed it from its list of additives allowed in food. Parabens are absorbed easily and have been measured in human blood, urine and breast tissue.",
    why_concerning:
      "Hormone-disrupting effects on the reproductive system led the EU to withdraw its approval for use in food.",
    who_should_avoid:
      "Pregnant women, couples trying to conceive, adolescents, and people with hormone-sensitive conditions.",
    banned_or_restricted_in: [
      "EU (removed from permitted food additives in 2006)",
      "Restricted in several other countries; still permitted in India and the US within limits",
    ],
    healthier_alternative:
      "Refrigerated products, or ones preserved with natural acids, rosemary extract or vitamin E; fresh bakery items.",
    commonly_found_in: [
      "packaged baked goods and cakes",
      "glazes and coatings on pastries",
      "some fillings and syrups",
      "food supplements",
      "processed cheese and dips (regionally)",
    ],
  },
  {
    name: "Tartrazine",
    e_code: "E102",
    ins_code: "INS 102",
    category: "color",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: 100,
    health_effects_detailed:
      "Tartrazine is a synthetic lemon-yellow coal-tar dye with no nutritional value — it is there purely for looks. It is one of the 'Southampton Six' colours shown in a 2007 UK study to increase hyperactivity, restlessness and inattention in children. It can also set off asthma attacks, hives and nasal congestion, particularly in people who react badly to aspirin. In the EU any food containing it must carry the warning 'may have an adverse effect on activity and attention in children'.",
    why_concerning:
      "Triggers behaviour changes in sensitive children and allergic-type reactions; entirely cosmetic.",
    who_should_avoid:
      "Children, especially those with ADHD; people with asthma, chronic hives or aspirin/NSAID sensitivity.",
    banned_or_restricted_in: [
      "Norway (historically)",
      "Austria (historically)",
      "EU (mandatory child-hyperactivity warning label)",
    ],
    healthier_alternative:
      "Products coloured with turmeric/curcumin (E100), annatto, beta-carotene or riboflavin, or with no added colour at all.",
    commonly_found_in: [
      "soft drinks and squashes",
      "instant noodles and soup mixes",
      "sweets and jellies",
      "ice cream",
      "packaged snacks / namkeen",
      "pickles",
    ],
  },
  {
    name: "Sunset Yellow FCF",
    e_code: "E110",
    ins_code: "INS 110",
    category: "color",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: 100,
    health_effects_detailed:
      "Sunset Yellow is a synthetic orange-yellow dye, also one of the Southampton Six linked to hyperactivity and a shorter attention span in children. It can cause allergic skin reactions, stomach upset and, rarely, swelling. Some older animal studies raised a possible tumour link, though regulators still permit it within limits. It carries the same EU warning label as tartrazine.",
    why_concerning:
      "Same child-behaviour and allergy concerns as tartrazine; purely cosmetic.",
    who_should_avoid:
      "Children (particularly with ADHD), people with asthma or aspirin sensitivity, anyone prone to hives.",
    banned_or_restricted_in: [
      "Norway (historically)",
      "Finland (historically)",
      "EU (mandatory hyperactivity warning label)",
    ],
    healthier_alternative:
      "Beta-carotene, annatto or paprika extract for colour, or no added colour.",
    commonly_found_in: [
      "orange soft drinks",
      "sweets and marzipan",
      "packaged snacks",
      "instant desserts",
      "biscuits",
      "jams and marmalade",
    ],
  },
  {
    name: "Brilliant Blue FCF",
    e_code: "E133",
    ins_code: "INS 133",
    category: "color",
    concern_level: "medium",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: 100,
    health_effects_detailed:
      "Brilliant Blue is a synthetic blue dye and most people absorb very little of it. It can cause hives or itching in sensitive individuals, and there is some concern that larger amounts might be absorbed through an inflamed or damaged gut. It is frequently blended with tartrazine to make green shades, which adds that dye's hyperactivity and allergy risks on top.",
    why_concerning:
      "Lower risk than the red and yellow azo dyes, but still a cosmetic additive that can cause allergy and is often paired with higher-risk colours.",
    who_should_avoid:
      "People with existing colour-additive allergies; children with hyperactivity when it is blended with azo dyes.",
    banned_or_restricted_in: [
      "Banned for years in several European countries (France, Germany and others) before EU harmonisation",
    ],
    healthier_alternative:
      "Spirulina extract (a natural blue) or products with no added colour.",
    commonly_found_in: [
      "blue and green sweets and ice lollies",
      "sports and energy drinks",
      "canned processed peas",
      "dairy desserts",
      "icing and cake decorations",
    ],
  },
  {
    name: "Carmoisine (Azorubine)",
    e_code: "E122",
    ins_code: "INS 122",
    category: "color",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: 100,
    health_effects_detailed:
      "Carmoisine is a synthetic red azo dye and one of the Southampton Six associated with hyperactivity and attention problems in children. It can worsen asthma and cause hives, especially in people sensitive to aspirin. When broken down in the body, azo dyes like this release aromatic amine compounds, which is the main reason they are viewed with suspicion.",
    why_concerning:
      "Child-behaviour effects plus allergy risk; carries the EU warning label and is banned in several countries.",
    who_should_avoid:
      "Children with ADHD, asthmatics, people with aspirin/salicylate intolerance or chronic hives.",
    banned_or_restricted_in: [
      "Norway",
      "Sweden (historically)",
      "USA (not approved for food)",
      "Japan",
    ],
    healthier_alternative:
      "Beetroot red (betanin, E162), or anthocyanins from black carrot or hibiscus; or no colour.",
    commonly_found_in: [
      "red and pink sweets and jellies",
      "flavoured yoghurts",
      "packaged juices and squashes",
      "cake mixes",
      "brown sauces",
      "marzipan",
    ],
  },
  {
    name: "Allura Red AC",
    e_code: "E129",
    ins_code: "INS 129",
    category: "color",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: 100,
    health_effects_detailed:
      "Allura Red (US 'Red 40') is a synthetic red dye linked to hyperactivity and irritability in children and to allergic reactions such as hives and swelling. Recent laboratory research suggests long-term intake may irritate the gut lining and could aggravate inflammatory bowel conditions. It is used purely to improve appearance.",
    why_concerning:
      "Behaviour effects in children, allergy risk, and emerging gut-inflammation concerns; EU warning label required.",
    who_should_avoid:
      "Children (especially with ADHD), people with inflammatory bowel disease, asthma or dye allergies.",
    banned_or_restricted_in: [
      "Denmark",
      "Belgium",
      "France",
      "Switzerland",
      "Sweden (historically)",
    ],
    healthier_alternative:
      "Beetroot red, black-carrot or radish anthocyanins, or paprika extract; or uncoloured products.",
    commonly_found_in: [
      "soft drinks",
      "sweets and chewing gum",
      "breakfast cereals",
      "flavoured milk",
      "gelatin desserts",
      "snack seasonings",
    ],
  },
  {
    name: "Ponceau 4R",
    e_code: "E124",
    ins_code: "INS 124",
    category: "color",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: 100,
    health_effects_detailed:
      "Ponceau 4R is a synthetic scarlet azo dye and one of the Southampton Six connected to hyperactivity in children. It can trigger asthma and hives in sensitive people and is a suspected carcinogen, which is why it is not allowed in the United States and Norway. It serves no nutritional purpose.",
    why_concerning:
      "Suspected cancer link on top of child-behaviour and allergy effects; banned in major markets.",
    who_should_avoid:
      "Children, asthmatics, people with aspirin sensitivity, and pregnant women choosing to be cautious.",
    banned_or_restricted_in: ["USA", "Norway", "Finland (historically)"],
    healthier_alternative:
      "Beetroot red, or anthocyanin plant extracts; or no colour.",
    commonly_found_in: [
      "tinned fruit and cherries",
      "sweets and jellies",
      "dessert mixes",
      "packaged juices",
      "sausages and seafood dressings",
      "cake decorations",
    ],
  },
  {
    name: "Erythrosine",
    e_code: "E127",
    ins_code: "INS 127",
    category: "color",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: 100,
    health_effects_detailed:
      "Erythrosine is a synthetic iodine-rich pink dye. Because it carries so much iodine it can interfere with the thyroid gland and shift thyroid hormone levels, especially with regular intake. High doses caused thyroid tumours in animal studies. It can also cause light sensitivity and allergic reactions. Many regulators now restrict it to only glacé/cocktail cherries.",
    why_concerning:
      "Thyroid disruption and animal tumour data; the US has moved to revoke its use in food.",
    who_should_avoid:
      "People with thyroid disorders, pregnant and breastfeeding women, and children.",
    banned_or_restricted_in: [
      "USA (FDA revoking food use, 2025)",
      "Norway",
      "Restricted to glacé/cocktail cherries in the EU and India",
    ],
    healthier_alternative:
      "Beetroot red, or anthocyanins; or unglazed fruit.",
    commonly_found_in: [
      "glacé and candied cherries",
      "cocktail cherries",
      "some pink sweets and biscuits",
      "canned fruit",
      "certain flavoured dairy desserts",
    ],
  },
  {
    name: "Monosodium Glutamate (MSG)",
    e_code: "E621",
    ins_code: "INS 621",
    category: "flavor enhancer",
    concern_level: "medium",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: null,
    health_effects_detailed:
      "MSG is the sodium salt of glutamate, an amino acid that occurs naturally in tomatoes, cheese, mushrooms and seaweed. In sensitive people, a large dose on an empty stomach can cause a short-lived cluster of symptoms sometimes called 'Chinese Restaurant Syndrome' — headache, flushing, sweating, chest tightness and a numb or tingling feeling. Most controlled studies find these effects are mild, uncommon and not dangerous. The bigger issue is that MSG makes salty, fatty processed food more moreish, which drives overeating, and it adds a lot of hidden sodium to the diet.",
    why_concerning:
      "Encourages overeating of ultra-processed food and adds hidden sodium; a minority of people get genuine short-term reactions. India bans added MSG in food for infants under 12 months and in products with a defined standard that does not allow it.",
    who_should_avoid:
      "People who notice MSG-symptom reactions, those on low-sodium diets for blood pressure, heart or kidney disease, and parents of very young children.",
    banned_or_restricted_in: [
      "No outright bans",
      "India, the EU and Codex require it to be declared on the label and set age and product restrictions",
    ],
    healthier_alternative:
      "Natural umami from tomato paste, mushrooms, dried seaweed (kombu) or aged cheese, and generous use of herbs and spices instead.",
    commonly_found_in: [
      "instant noodles and their seasoning sachets",
      "potato chips and namkeen",
      "soup and gravy mixes",
      "stock cubes",
      "ready-to-eat snacks",
      "restaurant-style frozen food",
    ],
  },
  {
    name: "Aspartame",
    e_code: "E951",
    ins_code: "INS 951",
    category: "sweetener",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: null,
    health_effects_detailed:
      "Aspartame is a low-calorie sweetener about 200 times sweeter than sugar. In 2023 the WHO's cancer agency (IARC) classified it as 'possibly carcinogenic to humans' (Group 2B) based on limited evidence for liver cancer, while the WHO's food-additive committee left the acceptable daily intake unchanged. In the body it breaks down into phenylalanine, aspartic acid and a small amount of methanol. People with the rare inherited condition phenylketonuria (PKU) cannot process phenylalanine and can suffer brain damage from it, so the label must warn them. Some people report aspartame triggers headaches or migraine.",
    why_concerning:
      "Possible-carcinogen classification, must-avoid status for people with PKU, a reported headache trigger, and it keeps a strong 'need for sweet' habit going.",
    who_should_avoid:
      "Anyone with phenylketonuria (PKU) — absolutely; pregnant women with high phenylalanine levels; people who get aspartame-linked headaches; young children.",
    banned_or_restricted_in: [
      "Not banned; IARC 'possibly carcinogenic' (Group 2B), 2023",
      "Mandatory 'Contains a source of phenylalanine' warning worldwide",
    ],
    healthier_alternative:
      "Whole fruit for sweetness; if a sweetener is needed, stevia (steviol glycosides), or simply reducing sweetness over time; plain water or soda instead of diet drinks.",
    commonly_found_in: [
      "'diet' and 'zero' soft drinks",
      "sugar-free chewing gum",
      "tabletop sweetener sachets",
      "sugar-free desserts and jellies",
      "some flavoured waters",
      "sugar-free mints and cough sweets",
    ],
  },
  {
    name: "Sodium Cyclamate",
    e_code: "E952",
    ins_code: "INS 952",
    category: "sweetener",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: null,
    health_effects_detailed:
      "Cyclamate is a sweetener about 30-50 times sweeter than sugar, usually blended with saccharin. It was banned in the United States in 1969 after a cyclamate-saccharin mix caused bladder tumours in rats. Later research did not clearly confirm a cancer risk in humans, so many countries (including in the EU and India) still allow small amounts. Gut bacteria can turn it into a compound called cyclohexylamine, which at high doses raises blood pressure and, in animal studies, harms the testes and sperm production.",
    why_concerning:
      "Historic bladder-tumour finding and a metabolite with reproductive-toxicity signals in animals; still banned in the US decades later.",
    who_should_avoid:
      "Pregnant women, couples trying to conceive, children, and anyone wanting to steer clear of contested additives.",
    banned_or_restricted_in: [
      "USA (since 1969)",
      "Restricted to low limits and specific products in the EU, India and Canada",
    ],
    healthier_alternative:
      "Whole fruit, a small amount of sugar, or stevia; unsweetened drinks.",
    commonly_found_in: [
      "tabletop sweetener tablets and sachets",
      "'sugar-free' soft drinks (outside the US)",
      "sugar-free jams and preserves",
      "sugar-free chewing gum and mints",
      "diabetic sweets",
    ],
  },
  {
    name: "Acesulfame Potassium (Acesulfame K)",
    e_code: "E950",
    ins_code: "INS 950",
    category: "sweetener",
    concern_level: "medium",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: null,
    health_effects_detailed:
      "Acesulfame K is a calorie-free sweetener around 200 times sweeter than sugar and very stable in heat, so it is used in baked and cooked products, usually blended with other sweeteners. The body does not break it down and passes it out unchanged in urine. Most safety studies find no clear harm, but the original tests were criticised as small and dated, and newer animal work hints at effects on the thyroid, on gut bacteria and on the brain's appetite control. Like all intense sweeteners it keeps a taste for very sweet things going.",
    why_concerning:
      "Thin original safety database, emerging gut-microbiome and appetite signals, and it sustains a sweet-taste preference that makes cutting sugar harder.",
    who_should_avoid:
      "Pregnant and breastfeeding women choosing caution, young children, and people trying to retrain their palate away from sweetness.",
    banned_or_restricted_in: [
      "Not banned; permitted in the EU, US, India and Codex within limits",
    ],
    healthier_alternative:
      "Unsweetened versions, whole fruit, or a small amount of sugar; water and plain milk instead of diet drinks.",
    commonly_found_in: [
      "'diet', 'zero' and 'no added sugar' soft drinks",
      "sugar-free chewing gum",
      "protein powders and bars",
      "sugar-free dairy desserts and yoghurt",
      "tabletop sweeteners",
      "baked goods labelled 'no added sugar'",
    ],
  },
  {
    name: "Sucralose",
    e_code: "E955",
    ins_code: "INS 955",
    category: "sweetener",
    concern_level: "medium",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: null,
    health_effects_detailed:
      "Sucralose is made by attaching chlorine atoms to sugar; it is about 600 times sweeter than sugar and calorie-free because the body cannot break it down. For years it was treated as inert, but newer research shows it can reduce helpful gut bacteria, and that heating it to high temperatures (baking, frying) can produce chlorinated compounds called chloropropanols, some of which are potentially harmful. A few studies link regular use to changes in blood sugar and insulin response and to increased appetite, which undercuts its usefulness for weight control.",
    why_concerning:
      "Gut-bacteria effects, formation of suspect compounds when cooked, and possible blood-sugar and appetite effects despite being 'zero calorie'.",
    who_should_avoid:
      "People who bake or cook with it at high heat, pregnant and breastfeeding women, people with blood-sugar problems or gut issues, and children.",
    banned_or_restricted_in: [
      "Not banned; the EU has advised against heating it strongly",
    ],
    healthier_alternative:
      "Whole fruit, a little sugar or honey, or stevia for cold uses; unsweetened drinks and cereals.",
    commonly_found_in: [
      "'diet' soft drinks and flavoured waters",
      "sugar-free desserts, jellies and ice cream",
      "protein bars and shakes",
      "sugar-free syrups and sauces",
      "chewing gum",
      "'no added sugar' baked goods",
    ],
  },
  {
    name: "BHA (Butylated Hydroxyanisole)",
    e_code: "E320",
    ins_code: "INS 320",
    category: "antioxidant",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: 200,
    health_effects_detailed:
      "BHA is a petroleum-derived antioxidant added to fatty foods to stop them going rancid. The US National Toxicology Program lists it as 'reasonably anticipated to be a human carcinogen' because it caused forestomach tumours in rats and hamsters. It can also act as a weak hormone (endocrine) disruptor, mimicking oestrogen, and may cause allergic skin reactions. It builds up in body fat over time.",
    why_concerning:
      "Animal carcinogen with a formal 'anticipated human carcinogen' listing, plus endocrine-disruption potential; accumulates in fat. The limit is usually set per unit of fat in the product.",
    who_should_avoid:
      "Pregnant women, young children, people with hormone-sensitive conditions, and anyone eating a lot of packaged fried or snack food.",
    banned_or_restricted_in: [
      "Japan (removed from the permitted list)",
      "EU (not permitted in food for infants and young children)",
    ],
    healthier_alternative:
      "Foods kept fresh with vitamin E (mixed tocopherols), rosemary extract or vitamin C; or buying smaller quantities and eating them sooner.",
    commonly_found_in: [
      "potato chips and fried snacks",
      "instant noodles",
      "chewing gum",
      "butter and lard",
      "breakfast cereals",
      "biscuits and crackers",
      "dried soups",
    ],
  },
  {
    name: "BHT (Butylated Hydroxytoluene)",
    e_code: "E321",
    ins_code: "INS 321",
    category: "antioxidant",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: 200,
    health_effects_detailed:
      "BHT is a close chemical cousin of BHA used for the same job — stopping fats and oils turning rancid. Animal studies are mixed: some found liver enlargement, thyroid changes and tumour-promoting effects, others found it protective, so regulators treat it as a possible but unproven human carcinogen. It acts as a hormone disruptor in laboratory tests and can cause skin rashes and, rarely, breathing problems in sensitive people. Like BHA it dissolves in fat and lingers in the body.",
    why_concerning:
      "Conflicting animal cancer data, endocrine-disruption signals and build-up in the body; often used alongside BHA, doubling exposure.",
    who_should_avoid:
      "Children, pregnant women, people with hormone-sensitive conditions or additive sensitivities.",
    banned_or_restricted_in: [
      "EU (not allowed in infant and young-child food)",
      "Australia restricts its use",
      "Removed voluntarily by many major brands",
    ],
    healthier_alternative:
      "Vitamin E, rosemary or green-tea extract as natural antioxidants; fresher products with a shorter shelf life.",
    commonly_found_in: [
      "breakfast cereals",
      "chewing gum",
      "packaged baked goods",
      "snack foods",
      "vegetable oils and shortening",
      "dehydrated potato products",
    ],
  },
  {
    name: "TBHQ (tertiary-Butylhydroquinone)",
    e_code: "E319",
    ins_code: "INS 319",
    category: "antioxidant",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: 200,
    health_effects_detailed:
      "TBHQ is a petroleum-based antioxidant used to keep frying oils and oily snacks from spoiling. It is potent — around 5 grams eaten at once can be fatal, causing nausea, vomiting, ringing in the ears, delirium and collapse — though normal food amounts are far below this. Animal studies have shown forestomach tumours, DNA damage and enlarged livers at higher doses. Newer research suggests it may weaken the immune system's response to infections and vaccines and could promote food allergies.",
    why_concerning:
      "Toxic in concentrated form, animal tumour and DNA-damage data, and emerging immune and allergy concerns.",
    who_should_avoid:
      "Children, pregnant women, people with food allergies or immune conditions, and heavy consumers of fried packaged snacks.",
    banned_or_restricted_in: [
      "Restricted to low limits in the EU and Japan",
      "Not permitted in infant foods",
    ],
    healthier_alternative:
      "Snacks fried in fresh oil preserved with vitamin E or rosemary extract; freshly fried food; nuts and roasted chana instead of packaged chips.",
    commonly_found_in: [
      "potato chips and corn snacks",
      "instant noodles",
      "biscuits and crackers",
      "microwave popcorn",
      "fast-food fried items",
      "vegetable oils and margarine",
    ],
  },
  {
    name: "High Fructose Corn Syrup",
    e_code: null,
    ins_code: null,
    category: "sweetener",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: null,
    health_effects_detailed:
      "High fructose corn syrup is a cheap liquid sweetener made from corn starch, used instead of sugar in many drinks and processed foods. It is roughly half fructose, and large amounts of fructose are processed almost entirely by the liver, where the excess is turned into fat. Regular high intake is strongly linked to non-alcoholic fatty liver disease, raised blood triglycerides, insulin resistance and type-2 diabetes, and because fructose does little to switch off hunger signals it encourages weight gain. Sugar-sweetened drinks are the single biggest source.",
    why_concerning:
      "Drives fatty liver, obesity and diabetes; very easy to over-consume in liquid form; also hidden in savoury products.",
    who_should_avoid:
      "People with obesity, fatty liver, diabetes, metabolic syndrome or high triglycerides; children who drink sweet beverages regularly.",
    banned_or_restricted_in: [
      "Not banned anywhere; EU production quotas (where it is called 'isoglucose' or 'glucose-fructose syrup') keep it far less common there",
    ],
    healthier_alternative:
      "Water, unsweetened tea, milk or whole fruit instead of sweet drinks; check the ingredient list and pick products with no added syrup.",
    commonly_found_in: [
      "soft drinks and colas",
      "packaged fruit juices and 'nectars'",
      "ketchup and barbecue sauce",
      "breakfast cereals and cereal bars",
      "biscuits and packaged cakes",
      "flavoured yoghurt",
      "jams",
    ],
  },
  {
    name: "Partially Hydrogenated Oils / Industrial Trans Fats",
    e_code: null,
    ins_code: null,
    category: "other",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: null,
    health_effects_detailed:
      "Partially hydrogenated oil is made by bubbling hydrogen through liquid vegetable oil to turn it semi-solid, giving long shelf life and a pleasant mouthfeel (vanaspati / 'dalda' is the classic Indian example). Industrial trans fat is the most harmful fat in the food supply: it raises 'bad' LDL cholesterol, lowers 'good' HDL cholesterol, inflames blood-vessel linings and promotes fat storage around the abdomen. Even small daily amounts measurably raise the risk of heart attacks, strokes and type-2 diabetes. India now caps industrial trans fat at 2% of total fat or oil, and the WHO has called for its complete removal worldwide.",
    why_concerning:
      "No safe level; directly increases heart-disease and stroke risk; still turns up in bakery products, street food and some vanaspati. The limit is a percentage of total fat, not a mg/kg figure.",
    who_should_avoid:
      "Everyone, and especially people with heart disease, high cholesterol, diabetes or a family history of these; pregnant women.",
    banned_or_restricted_in: [
      "Denmark (first national ban, 2003)",
      "USA (partially hydrogenated oils no longer 'generally recognised as safe', 2018-2021)",
      "EU (2% limit since 2021)",
      "India (2% limit since 2022)",
    ],
    healthier_alternative:
      "Products made with non-hydrogenated oils, or ghee/butter in moderation; an ingredient list with no 'partially hydrogenated' oil and a nutrition panel showing '0 g trans fat'; fresh bakery items.",
    commonly_found_in: [
      "vanaspati / margarine / bakery shortening",
      "commercial biscuits, cookies, cakes and pastries",
      "deep-fried street snacks reusing hydrogenated fat",
      "cream-filled wafers and rusks",
      "non-dairy creamers",
      "some instant noodles",
    ],
  },
  {
    name: "Carrageenan",
    e_code: "E407",
    ins_code: "INS 407",
    category: "emulsifier",
    concern_level: "medium",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: null,
    health_effects_detailed:
      "Carrageenan is a gum extracted from red seaweed, used to thicken and stop separation in dairy and plant milks. Food-grade carrageenan is not digested and mostly passes through, but laboratory and animal studies suggest it can irritate the gut lining and promote low-grade inflammation, and some people with bloating, cramps or inflammatory bowel disease feel better when they cut it out. A degraded, lower-weight form called poligeenan is a known intestinal carcinogen, and there is concern that stomach acid and processing can turn a small fraction of food carrageenan into that form. Human evidence is still limited and regulators currently consider it safe.",
    why_concerning:
      "Possible gut irritation and inflammation, and a theoretical link to the carcinogenic degraded form; removed by many 'clean-label' brands as a precaution.",
    who_should_avoid:
      "People with irritable bowel syndrome, inflammatory bowel disease, chronic bloating or unexplained digestive symptoms; infants (it is restricted in some infant formulas).",
    banned_or_restricted_in: [
      "Not permitted in infant formula in the EU",
      "Repeatedly debated for removal by the US organic board; widely dropped by clean-label brands",
    ],
    healthier_alternative:
      "Products thickened with guar gum, locust bean gum, agar or pectin, or nothing at all; shake-before-use plant milks; homemade versions.",
    commonly_found_in: [
      "plant-based milks (almond, soy, oat)",
      "flavoured and UHT dairy milk",
      "cream and whipping cream",
      "ice cream",
      "processed and cottage cheese",
      "deli meats",
      "jellies and desserts",
    ],
  },
  {
    name: "Azodicarbonamide",
    e_code: "E927a",
    ins_code: "INS 927a",
    category: "other",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: 45,
    health_effects_detailed:
      "Azodicarbonamide is a flour 'improver' and dough conditioner that makes bread whiter and more elastic; it is also the chemical that puts the bubbles in yoga mats and shoe soles. When flour containing it is baked, it breaks down into semicarbazide and urethane (ethyl carbamate), both of which caused tumours in animal studies. Handling the raw powder is a recognised cause of occupational asthma and skin sensitisation in bakery workers. Consumer exposure from bread is much lower, but several regions banned it as an unnecessary risk.",
    why_concerning:
      "Its breakdown products are animal carcinogens, it is a known respiratory sensitiser, and it serves only a cosmetic and texture purpose.",
    who_should_avoid:
      "People with asthma or chronic respiratory conditions, bakery workers, children eating a lot of packaged white bread, and pregnant women.",
    banned_or_restricted_in: [
      "EU",
      "Australia and New Zealand",
      "UK",
      "Singapore (heavy fines)",
      "Still permitted in India and the US",
    ],
    healthier_alternative:
      "Bread with a short ingredient list (flour, water, yeast, salt), whole-grain or sourdough bread, or products that use ascorbic acid (vitamin C) as the dough improver.",
    commonly_found_in: [
      "packaged white sandwich bread and pav",
      "burger and hot-dog buns",
      "commercial pizza dough",
      "some refined flour (maida)",
      "packaged rolls and wraps",
    ],
  },
  {
    name: "Polysorbate 80",
    e_code: "E433",
    ins_code: "INS 433",
    category: "emulsifier",
    concern_level: "medium",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: null,
    health_effects_detailed:
      "Polysorbate 80 is a synthetic emulsifier that keeps oil and water mixed, giving ice cream a smooth texture and stopping sauces from splitting. Animal studies show that emulsifiers like this can thin the protective mucus layer of the gut, let bacteria get closer to the gut wall, and trigger low-grade inflammation, leading to weight gain and worse blood-sugar control in mice. Early human studies point the same way. It can also, rarely, cause serious allergic reactions, as it is used as a carrier in some injected medicines and vaccines.",
    why_concerning:
      "Emerging evidence that it disturbs the gut lining and its bacteria, promoting inflammation and metabolic problems; rare severe allergy.",
    who_should_avoid:
      "People with inflammatory bowel disease, irritable bowel syndrome or metabolic syndrome, and anyone with a history of reactions to polysorbate-containing medicines.",
    banned_or_restricted_in: [
      "Not banned; permitted in the EU, US and India within limits, but flagged in reviews of dietary emulsifiers and dropped by some clean-label brands",
    ],
    healthier_alternative:
      "Products emulsified with lecithin or egg yolk, or nothing (shake-before-use); simple ice cream made from cream, milk, sugar and egg.",
    commonly_found_in: [
      "ice cream and frozen desserts",
      "whipped toppings and non-dairy creamer",
      "salad dressings and sauces",
      "packaged cake and icing",
      "chewing gum",
      "some pickles and gravies",
    ],
  },
  {
    name: "Sodium Benzoate + Ascorbic Acid (Vitamin C) combination",
    e_code: "E211 + E300",
    ins_code: "INS 211 + INS 300",
    category: "preservative",
    concern_level: "high",
    legal_in_india: true,
    max_limit_in_india_mg_per_kg: null,
    health_effects_detailed:
      "This is not a single additive but a dangerous pairing. When a preservative from the benzoate family (sodium benzoate E211, benzoic acid E210, potassium benzoate E212) sits in the same product as vitamin C (ascorbic acid E300) or its relatives, the two can react — especially in warm storage, in light, or over a long shelf life — to form benzene, a chemical that definitely causes cancer (leukaemia) in humans. The amounts formed are usually small, but soft drinks have been recalled around the world for going over drinking-water benzene limits. Consumers cannot see or taste benzene.",
    why_concerning:
      "The reaction produces benzene, a Group 1 human carcinogen, inside the finished product; the risk rises with heat, light and time on the shelf.",
    who_should_avoid:
      "Children and teenagers (who drink the most soft drinks), pregnant women, and anyone storing such drinks somewhere hot like a car or a non-air-conditioned shop.",
    banned_or_restricted_in: [
      "No specific ban on the combination, but the US FDA, EU and others monitor benzene in soft drinks and have forced reformulations and recalls",
      "Many manufacturers have voluntarily stopped combining the two",
    ],
    healthier_alternative:
      "Drinks that use only one of the two (a benzoate preservative OR added vitamin C, not both), drinks preserved by refrigeration or pasteurisation, or plain water, milk and freshly squeezed juice.",
    commonly_found_in: [
      "fruit-flavoured soft drinks and sodas",
      "fruit squashes and cordials",
      "'fortified with vitamin C' juice drinks",
      "flavoured waters",
      "energy drinks",
      "some pickles and sauces",
    ],
  },
];

// ============================================================================
// 4. PRODUCT CATEGORIES
// ============================================================================

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  { id: "snacks", name: "Snacks", icon_emoji: "🍿", examples: ["potato chips", "namkeen", "kurkure-style corn puffs", "roasted chana", "popcorn"] },
  { id: "beverages", name: "Beverages", icon_emoji: "🥤", examples: ["soft drinks", "packaged juice", "energy drinks", "iced tea", "squash / cordial"] },
  { id: "dairy", name: "Dairy", icon_emoji: "🥛", examples: ["milk", "curd / dahi", "paneer", "cheese", "butter", "flavoured yoghurt"] },
  { id: "bakery", name: "Bakery", icon_emoji: "🍞", examples: ["bread", "pav / buns", "rusk", "cakes", "cookies", "puffs"] },
  { id: "instant_food", name: "Instant Food", icon_emoji: "🍜", examples: ["instant noodles", "cup soups", "ready-to-eat curries", "pasta cups", "upma / poha mixes"] },
  { id: "sauces_condiments", name: "Sauces & Condiments", icon_emoji: "🧂", examples: ["ketchup", "mayonnaise", "soy sauce", "pickles / achar", "chutneys", "salad dressings"] },
  { id: "breakfast_cereals", name: "Breakfast Cereals", icon_emoji: "🥣", examples: ["corn flakes", "muesli", "oats", "choco pops", "wheat flakes"] },
  { id: "confectionery", name: "Confectionery", icon_emoji: "🍬", examples: ["chocolate", "candy / toffee", "chewing gum", "lollipops", "mithai in packs", "jellies"] },
  { id: "frozen_food", name: "Frozen Food", icon_emoji: "🧊", examples: ["frozen peas and vegetables", "frozen parathas", "nuggets", "ice cream", "frozen snacks"] },
  { id: "personal_care", name: "Personal Care", icon_emoji: "🧴", examples: ["toothpaste", "soap", "shampoo", "face cream", "deodorant", "sanitary products"] },
  { id: "household", name: "Household", icon_emoji: "🧽", examples: ["dishwash", "floor cleaner", "detergent", "toilet cleaner", "room freshener"] },
  { id: "baby_food", name: "Baby Food", icon_emoji: "🍼", examples: ["infant formula", "cereal-based baby food", "toddler snacks", "follow-up formula"] },
  { id: "health_supplements", name: "Health Supplements", icon_emoji: "💊", examples: ["protein powder", "multivitamins", "health drinks", "energy bars", "electrolyte mixes"] },
  { id: "cooking_oils", name: "Cooking Oils & Fats", icon_emoji: "🫗", examples: ["refined oils", "mustard oil", "ghee", "vanaspati", "olive oil"] },
  { id: "spices", name: "Spices & Masalas", icon_emoji: "🌶️", examples: ["turmeric powder", "chilli powder", "garam masala", "coriander powder", "blended masalas"] },
  { id: "meat_products", name: "Meat & Poultry Products", icon_emoji: "🍗", examples: ["frozen chicken", "sausages", "salami / ham", "fish fillets", "canned meat"] },
  { id: "packaged_water", name: "Packaged Water", icon_emoji: "💧", examples: ["packaged drinking water", "mineral water", "20 L jars", "flavoured water"] },
  { id: "packaged_fruits_vegetables", name: "Packaged Fruits & Vegetables", icon_emoji: "🥗", examples: ["pre-cut fruit", "packed salad", "sprouts", "canned fruit", "vacuum-packed vegetables"] },
];

// ============================================================================
// 5. HEALTHIER ALTERNATIVES MAPPING
// ============================================================================
// Keyed by ingredient name. Covers every entry in BANNED_INGREDIENTS and
// HARMFUL_ADDITIVES above.

export const HEALTHIER_ALTERNATIVES: Record<string, HealthierAlternative> = {
  // ---- Banned ingredients ----
  "Potassium Bromate": {
    alternatives: ["ascorbic acid (vitamin C) as a dough improver", "whole-wheat / atta bread", "sourdough", "traditionally leavened breads"],
    explanation:
      "Vitamin C does the same dough-strengthening job without the cancer risk, and denser whole-grain or naturally fermented breads do not need a bleaching agent at all.",
    what_to_look_for_on_label:
      "'No added potassium bromate / KBrO3-free', 'no bromate', a short ingredient list, or 'atta' / 'whole wheat' / 'sourdough' as the base flour.",
  },
  "Brominated Vegetable Oil": {
    alternatives: ["drinks stabilised with glycerol ester of wood rosin (ester gum, E445)", "sucrose acetate isobutyrate (E444)", "cloudy juices with natural pulp", "plain soda with fresh citrus"],
    explanation:
      "Modern stabilisers keep citrus oils mixed without adding bromine, which builds up in body fat for months.",
    what_to_look_for_on_label:
      "Absence of 'brominated vegetable oil' or 'BVO'; presence of 'ester gum', 'E445' or 'glycerol ester of rosin' instead.",
  },
  "Metanil Yellow": {
    alternatives: ["pure turmeric bought as whole fingers and ground at home", "certified brands sold in sealed packs", "saffron or annatto where a yellow tint is wanted"],
    explanation:
      "Whole turmeric cannot easily be adulterated with an industrial dye, and sealed branded packs with an FSSAI number are accountable if tested.",
    what_to_look_for_on_label:
      "'100% turmeric', an FSSAI 14-digit number, AGMARK or a batch/lot code; buy whole haldi and grind it yourself for spices you use a lot.",
  },
  "Rhodamine B": {
    alternatives: ["beetroot juice or powder", "pomegranate / hibiscus extract", "uncoloured sweets and cotton candy"],
    explanation:
      "Plant pigments give a natural pink or red without the liver, kidney and nerve toxicity of a textile dye.",
    what_to_look_for_on_label:
      "'No artificial colour', 'coloured with beetroot / anthocyanin', or a plain white/cream sweet; avoid loose, unlabelled bright-pink items.",
  },
  "Sudan Dyes (I, II, III, IV)": {
    alternatives: ["whole dried red chillies ground at home", "paprika from a sealed branded pack", "Kashmiri chilli for colour without heat"],
    explanation:
      "Grinding your own chilli removes the chance for someone to blend in an oil-soluble industrial dye, and reputable packed brands are batch-traceable.",
    what_to_look_for_on_label:
      "FSSAI number, 'no added colour', a manufacture/lot code; prefer whole chillies or single-brand sealed powder over loose powder.",
  },
  "Calcium Carbide": {
    alternatives: ["naturally ripened fruit bought slightly firm and ripened at home", "fruit ripened commercially with ethylene gas (permitted up to 100 ppm)", "seasonal fruit from known growers"],
    explanation:
      "Fruit ripens perfectly well at room temperature in a paper bag; ethylene-gas ripening chambers are the legal commercial method and leave no arsenic or phosphorus residue.",
    what_to_look_for_on_label:
      "'Ripened with ethylene' on cartons; for loose fruit, choose evenly green or naturally colour-graded fruit with no black soot specks or garlic smell, and ripen it yourself.",
  },
  "Formalin (Formaldehyde)": {
    alternatives: ["fresh fish kept on plenty of flaked ice", "frozen-at-sea fish", "fish from a high-turnover market bought early in the day"],
    explanation:
      "Proper cold-chain handling keeps fish fresh without any chemical; formalin is only used to fake freshness in fish that is already old.",
    what_to_look_for_on_label:
      "For packed fish: a clear packing and expiry date and continuous cold storage. For loose fish: a genuine fishy sea smell, springy flesh, bright red gills, flies present around the stall (their absence is a red flag), and use an FSSAI formaldehyde test strip if available.",
  },
  "Oxytocin": {
    alternatives: ["milk from a trusted dairy brand or cooperative", "vegetables from organic or known local growers", "seasonal produce of normal size"],
    explanation:
      "Regulated dairies do not use banned hormones, and normal-sized seasonal vegetables have far less chance of being injected to look bigger.",
    what_to_look_for_on_label:
      "A recognised dairy brand with an FSSAI number; for vegetables, avoid unusually large, watery, fast-spoiling gourds, brinjals and cucumbers.",
  },
  "Malachite Green": {
    alternatives: ["marine (sea-caught) fish", "fish from certified or inspected aquaculture", "other protein sources such as eggs, chicken or dal"],
    explanation:
      "Malachite green is an illegal antifungal used in some fish farming; sea fish and certified farms do not use it.",
    what_to_look_for_on_label:
      "Country/'catch method' info on packed fish; for loose fish avoid a blue-green tint on gills, fins or belly and blue-tinged ice.",
  },
  "Lead Chromate": {
    alternatives: ["whole turmeric fingers ground at home", "sealed branded turmeric with an FSSAI number", "unpolished whole dals"],
    explanation:
      "Lead chromate is added to loose powders to brighten the colour; whole spices and pulses cannot be adulterated this way and branded packs are testable.",
    what_to_look_for_on_label:
      "FSSAI number, '100% turmeric / dal', a lot code; drop-in-water test at home (bright yellow streaks from turmeric or a coloured film on dal = reject).",
  },
  "Copper Sulphate": {
    alternatives: ["naturally coloured vegetables, even if dull", "vegetables from organic or trusted growers", "frozen peas from a branded pack"],
    explanation:
      "The natural green of vegetables fades a little after picking; an unnaturally glossy, deep, uniform green often means a copper wash.",
    what_to_look_for_on_label:
      "For packed produce, an FSSAI number and packing date; for loose produce, wipe with a wet white cloth and reject anything that leaves a blue-green stain.",
  },
  "Argemone Seeds / Oil": {
    alternatives: ["branded, sealed, AGMARK-graded mustard oil", "cold-pressed 'kachi ghani' mustard oil from a known mill", "other oils such as groundnut or sesame"],
    explanation:
      "Sealed, graded mustard oil is far less likely to be cut with cheap argemone oil, which causes swelling, glaucoma and blindness.",
    what_to_look_for_on_label:
      "'AGMARK', a sealed tamper-proof cap, an FSSAI number, and a batch code; avoid loose mustard oil sold from open tins.",
  },
  "Toluene in Food Packaging": {
    alternatives: ["products in packaging with a separate food-grade inner liner", "glass jars or cans", "brands using low-migration or water-based inks"],
    explanation:
      "A food-grade inner layer keeps printing solvents away from the food; glass and lined cans do not transfer ink chemicals at all.",
    what_to_look_for_on_label:
      "No printing on the inside surface that touches the food, no strong solvent smell on opening, and ideally 'food-grade packaging' or a metal/glass container.",
  },
  "Stapler Pins in Tea Bags": {
    alternatives: ["tea bags sealed with a knot, crimp or heat-seal", "loose-leaf tea with an infuser", "string-and-tag bags with no metal"],
    explanation:
      "Knotted or heat-sealed bags hold together just as well without a loose metal pin that can end up in your cup.",
    what_to_look_for_on_label:
      "Look at the actual bag: the tag and string should be joined by a knot, fold or heat-seal, never a metal staple.",
  },
  "Titanium Dioxide": {
    alternatives: ["sweets and gums with no whitening agent", "products whitened with rice starch or calcium carbonate", "darker or naturally coloured confectionery"],
    explanation:
      "Titanium dioxide only makes things look whiter and more opaque; the EU banned it over DNA-damage concerns and products do fine without it.",
    what_to_look_for_on_label:
      "Absence of 'titanium dioxide', 'INS 171', 'E171' or 'colour (171)' in the ingredient list.",
  },

  // ---- Harmful additives ----
  "Sodium Benzoate": {
    alternatives: ["refrigerated products", "items preserved with potassium sorbate alone", "naturally acidic preserves (vinegar, lemon)", "fresh juice"],
    explanation:
      "Other preservation methods avoid both the hyperactivity link and the benzene that forms when benzoate meets vitamin C.",
    what_to_look_for_on_label:
      "No 'E211' / 'sodium benzoate', and especially not alongside 'ascorbic acid' / 'vitamin C' / 'E300'; 'preservative-free' or 'keep refrigerated'.",
  },
  "Potassium Sorbate": {
    alternatives: ["fresh or refrigerated versions of the same food", "vacuum-packed products with a short shelf life", "home-made equivalents"],
    explanation:
      "Potassium sorbate is low-risk, but choosing fresher food means fewer additives overall and usually better taste and nutrition.",
    what_to_look_for_on_label:
      "'No preservatives added', a short ingredient list, or a 'best before' date only weeks away rather than a year.",
  },
  "Sodium Nitrite": {
    alternatives: ["fresh unprocessed meat", "'uncured' / 'no added nitrite' bacon and ham", "poultry or fish", "beans, lentils, paneer and egg for sandwiches"],
    explanation:
      "Cutting cured meat lowers exposure to the nitrosamines that form on cooking and to the processed-meat bowel-cancer risk.",
    what_to_look_for_on_label:
      "'No added nitrite/nitrate', 'uncured'; absence of 'E250', 'E249', 'sodium nitrite' — and eat processed meat rarely rather than daily.",
  },
  "Sodium Nitrate": {
    alternatives: ["fresh meat and cheese without added nitrate", "refrigerated or frozen meat instead of dry-cured", "traditional cheeses that do not use nitrate"],
    explanation:
      "Nitrate turns into nitrite in the body, so avoiding it lowers the same cancer and infant-oxygen risks.",
    what_to_look_for_on_label:
      "Absence of 'E251', 'E252', 'sodium nitrate', 'potassium nitrate' / 'saltpetre'.",
  },
  "Propyl Paraben": {
    alternatives: ["refrigerated baked goods", "products preserved with vitamin E or rosemary extract", "fresh bakery items eaten within days"],
    explanation:
      "Avoiding propyl paraben removes a known hormone disruptor that the EU no longer allows in food.",
    what_to_look_for_on_label:
      "Absence of 'E216', 'E217', 'propylparaben', 'propyl 4-hydroxybenzoate'.",
  },
  "Tartrazine": {
    alternatives: ["turmeric/curcumin (E100)", "annatto", "beta-carotene", "riboflavin", "uncoloured products"],
    explanation:
      "Natural yellows colour food without the hyperactivity, asthma and hives linked to this coal-tar dye.",
    what_to_look_for_on_label:
      "No 'E102', 'tartrazine', 'FD&C Yellow 5', 'CI 19140'; look for 'colours from natural sources' or 'no artificial colours'.",
  },
  "Sunset Yellow FCF": {
    alternatives: ["beta-carotene", "annatto", "paprika extract", "no added colour"],
    explanation:
      "Plant-based oranges avoid the Southampton-Six behaviour and allergy concerns.",
    what_to_look_for_on_label:
      "No 'E110', 'sunset yellow', 'FD&C Yellow 6', 'CI 15985'.",
  },
  "Brilliant Blue FCF": {
    alternatives: ["spirulina extract (natural blue)", "no added colour", "products coloured only with fruit or vegetable juice"],
    explanation:
      "Spirulina gives a clean blue and avoids a synthetic dye that is often blended with tartrazine to make green.",
    what_to_look_for_on_label:
      "No 'E133', 'brilliant blue', 'FD&C Blue 1', 'CI 42090'.",
  },
  "Carmoisine (Azorubine)": {
    alternatives: ["beetroot red (E162)", "black carrot or hibiscus anthocyanins", "no added colour"],
    explanation:
      "Natural reds avoid the child-behaviour effects and the aromatic amines released when azo dyes break down.",
    what_to_look_for_on_label:
      "No 'E122', 'carmoisine', 'azorubine', 'CI 14720'.",
  },
  "Allura Red AC": {
    alternatives: ["beetroot red", "black-carrot or radish anthocyanins", "paprika extract", "uncoloured products"],
    explanation:
      "Plant pigments avoid the hyperactivity link and the newer gut-lining irritation concerns.",
    what_to_look_for_on_label:
      "No 'E129', 'allura red', 'FD&C Red 40', 'CI 16035'.",
  },
  "Ponceau 4R": {
    alternatives: ["beetroot red", "anthocyanin plant extracts", "no added colour"],
    explanation:
      "Natural scarlet options avoid a suspected carcinogen that the US and Norway do not permit.",
    what_to_look_for_on_label:
      "No 'E124', 'ponceau 4R', 'cochineal red A', 'CI 16255'.",
  },
  "Erythrosine": {
    alternatives: ["beetroot red", "anthocyanins", "unglazed fruit"],
    explanation:
      "Iodine-free natural pinks avoid the thyroid disruption linked to this dye.",
    what_to_look_for_on_label:
      "No 'E127', 'erythrosine', 'FD&C Red 3', 'CI 45430'; choose plain (undyed) cherries.",
  },
  "Monosodium Glutamate (MSG)": {
    alternatives: ["tomato paste, mushrooms, seaweed (kombu), aged cheese for natural umami", "herbs, spices, garlic and onion", "yeast extract used sparingly"],
    explanation:
      "Whole-food umami adds savoury depth without the added sodium load or the reactions some people get from a big MSG dose.",
    what_to_look_for_on_label:
      "No 'E621', 'monosodium glutamate', 'added MSG', 'flavour enhancer (621)'; be aware 'hydrolysed vegetable protein' and 'yeast extract' also carry free glutamate.",
  },
  "Aspartame": {
    alternatives: ["whole fruit", "stevia (steviol glycosides)", "small amounts of sugar", "plain or soda water"],
    explanation:
      "Cutting aspartame removes a possible carcinogen (IARC 2B) and a common headache trigger, and helps reset a very-sweet palate.",
    what_to_look_for_on_label:
      "No 'E951', 'aspartame', 'contains a source of phenylalanine'; 'no artificial sweeteners'.",
  },
  "Sodium Cyclamate": {
    alternatives: ["whole fruit", "a little sugar", "stevia", "unsweetened drinks"],
    explanation:
      "Avoiding cyclamate sidesteps an additive with a historic bladder-tumour finding that the US still bans.",
    what_to_look_for_on_label:
      "No 'E952', 'cyclamate', 'cyclamic acid', 'sodium/calcium cyclamate'.",
  },
  "Acesulfame Potassium (Acesulfame K)": {
    alternatives: ["whole fruit", "small amounts of sugar", "stevia", "unsweetened versions"],
    explanation:
      "Reducing intense sweeteners generally helps appetite control and lets you taste natural sweetness again.",
    what_to_look_for_on_label:
      "No 'E950', 'acesulfame K', 'acesulfame potassium', 'ace-K'.",
  },
  Sucralose: {
    alternatives: ["whole fruit", "a little sugar or honey (cold uses)", "stevia", "unsweetened drinks and cereals"],
    explanation:
      "Avoiding sucralose sidesteps gut-bacteria effects and the suspect compounds formed when it is baked or fried.",
    what_to_look_for_on_label:
      "No 'E955', 'sucralose', 'trichlorogalactosucrose'; note 'Splenda'-type tabletop blends.",
  },
  "BHA (Butylated Hydroxyanisole)": {
    alternatives: ["products preserved with mixed tocopherols (vitamin E)", "rosemary or green-tea extract", "smaller packs eaten fresh"],
    explanation:
      "Natural antioxidants stop fats going rancid without an 'anticipated human carcinogen'.",
    what_to_look_for_on_label:
      "No 'E320', 'BHA', 'butylated hydroxyanisole'; look for 'tocopherols', 'rosemary extract' or 'vitamin E' as the antioxidant.",
  },
  "BHT (Butylated Hydroxytoluene)": {
    alternatives: ["vitamin E (tocopherols)", "rosemary or green-tea extract", "fresher products with a shorter shelf life"],
    explanation:
      "The same natural antioxidants replace BHT and avoid its conflicting cancer data and hormone-disruption signals.",
    what_to_look_for_on_label:
      "No 'E321', 'BHT', 'butylated hydroxytoluene'.",
  },
  "TBHQ (tertiary-Butylhydroquinone)": {
    alternatives: ["freshly fried food", "snacks fried in oil preserved with vitamin E or rosemary extract", "nuts and roasted chana"],
    explanation:
      "Choosing fresher fried food avoids an additive that is toxic in concentrated form and linked to immune and allergy effects.",
    what_to_look_for_on_label:
      "No 'E319', 'TBHQ', 'tertiary butylhydroquinone', 'tert-butylhydroquinone'.",
  },
  "High Fructose Corn Syrup": {
    alternatives: ["water, milk, unsweetened tea", "whole fruit", "products sweetened with modest amounts of ordinary sugar", "plain yoghurt with fruit"],
    explanation:
      "Cutting sugar-sweetened drinks and syrup-laden foods is the single biggest step against fatty liver, weight gain and diabetes.",
    what_to_look_for_on_label:
      "No 'high fructose corn syrup', 'HFCS', 'corn syrup', 'glucose-fructose syrup', 'isoglucose', 'liquid glucose' near the top of the list.",
  },
  "Partially Hydrogenated Oils / Industrial Trans Fats": {
    alternatives: ["non-hydrogenated vegetable oils", "ghee or butter in moderation", "cold-pressed oils", "fresh bakery made with butter/oil"],
    explanation:
      "Industrial trans fat has no safe level; ordinary oils and fats do the same job without raising heart-attack and stroke risk.",
    what_to_look_for_on_label:
      "No 'partially hydrogenated', 'vanaspati', 'hydrogenated vegetable oil', 'edible vegetable fat'; nutrition panel 'trans fat 0 g' AND no PHO in the ingredients.",
  },
  Carrageenan: {
    alternatives: ["products thickened with guar gum, locust bean gum, agar or pectin", "shake-before-use plant milks", "home-made versions"],
    explanation:
      "Other thickeners give the same texture without the gut-irritation and inflammation concerns tied to carrageenan.",
    what_to_look_for_on_label:
      "No 'E407', 'carrageenan', 'Irish moss extract', 'E407a' (processed eucheuma seaweed).",
  },
  Azodicarbonamide: {
    alternatives: ["bread with a flour/water/yeast/salt ingredient list", "whole-grain or sourdough bread", "products using ascorbic acid as the improver"],
    explanation:
      "Simple or naturally fermented bread does not need a conditioner whose breakdown products caused tumours in animals.",
    what_to_look_for_on_label:
      "No 'azodicarbonamide', 'ADA', 'E927a', 'flour treatment agent (927a)'.",
  },
  "Polysorbate 80": {
    alternatives: ["products emulsified with lecithin or egg yolk", "shake-before-use dressings", "simple ice cream (cream, milk, sugar, egg)"],
    explanation:
      "Lecithin and egg do the emulsifying job without the gut-lining and inflammation effects seen with synthetic emulsifiers.",
    what_to_look_for_on_label:
      "No 'E433', 'polysorbate 80', 'polyoxyethylene sorbitan mono-oleate', 'Tween 80'; 'soy lecithin' or 'sunflower lecithin' instead.",
  },
  "Sodium Benzoate + Ascorbic Acid (Vitamin C) combination": {
    alternatives: ["drinks with only one of the two", "refrigerated or pasteurised drinks with no benzoate", "plain water, milk, fresh juice"],
    explanation:
      "Keeping benzoate and vitamin C out of the same bottle removes the conditions that let cancer-causing benzene form on the shelf.",
    what_to_look_for_on_label:
      "Scan for 'E211'/'sodium benzoate'/'E210'/'E212' AND 'ascorbic acid'/'vitamin C'/'E300' together — if both appear, choose a different product.",
  },
};

// ============================================================================
// 5b. FSSAI PRESCRIBED ADDITIVE LIMITS (dosage / maximum-limit checking)
// ============================================================================
// Maximum permitted levels for common food additives under the Food Safety and
// Standards (Food Products Standards and Food Additives) Regulations, 2011.
// Numbers are the headline FSSAI maxima in mg/kg (or mg/l) of finished product;
// `special_limits` carry the category-specific figures. `null` = permitted at
// GMP (no fixed number). Figures are for consumer screening — always verify
// against the current FSSAI notification before acting.

export const FSSAI_ADDITIVE_LIMITS: FssaiAdditiveLimit[] = [
  // ---- PRESERVATIVES ----
  {
    name: "Sodium Benzoate",
    also_known_as: ["sodium benzoate", "E211", "INS 211", "benzoate of soda", "benzoic acid (as sodium salt)"],
    e_code: "E211",
    ins_code: "INS 211",
    category: "preservative",
    fssai_max_limit_mg_per_kg: 200,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — Appendix A, preservatives table (benzoic acid and its salts).",
    applies_to: ["beverages", "carbonated water", "fruit squashes and cordials"],
    special_limits: [
      { category: "sauces, ketchup and salad dressings", limit_mg_per_kg: 1000 },
      { category: "pickles and chutneys", limit_mg_per_kg: 750 },
      { category: "jam, jelly and marmalade", limit_mg_per_kg: 200 },
    ],
    what_happens_above_limit:
      "Above the limit the chance of benzene forming inside the product rises sharply — especially when vitamin C (ascorbic acid) is also present — and benzene causes leukaemia in humans. Higher intakes are also linked to hyperactivity and restlessness in children and to hives and asthma flare-ups in sensitive people.",
    how_to_check:
      "Packs almost never print the amount. Treat it as a concern if 'sodium benzoate' / 'E211' appears early in the ingredients list (ingredients run high-to-low by weight), or if it appears in the same list as 'ascorbic acid' / 'vitamin C' / 'E300'.",
  },
  {
    name: "Potassium Sorbate",
    also_known_as: ["potassium sorbate", "E202", "INS 202", "sorbate of potash", "sorbic acid (as potassium salt)"],
    e_code: "E202",
    ins_code: "INS 202",
    category: "preservative",
    fssai_max_limit_mg_per_kg: 1000,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — Appendix A, preservatives table (sorbic acid and its salts).",
    applies_to: ["cheese", "dried fruit", "baked goods", "confectionery", "dips and spreads"],
    special_limits: [
      { category: "beverages and flavoured drinks", limit_mg_per_kg: 300 },
      { category: "wine", limit_mg_per_kg: 200 },
    ],
    what_happens_above_limit:
      "Sorbate is one of the gentler preservatives, but well above the limit it can cause mild irritation of the lips, mouth and skin and, rarely, an itchy rash. Its main signal is that the food is heavily processed.",
    how_to_check:
      "Look at where 'potassium sorbate' / 'E202' sits in the ingredients list. In a drink it should be a very minor, late-listed ingredient.",
  },
  {
    name: "Sodium Metabisulphite",
    also_known_as: ["sodium metabisulphite", "sodium metabisulfite", "E223", "INS 223", "sodium pyrosulphite", "SO2 (as metabisulphite)"],
    e_code: "E223",
    ins_code: "INS 223",
    category: "preservative",
    fssai_max_limit_mg_per_kg: 100,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — sulphur dioxide and sulphites table; allergen declaration required above 10 mg/kg under the Labelling and Display Regulations, 2020.",
    applies_to: ["beverages", "fruit juices", "sugar syrups", "dehydrated vegetables"],
    special_limits: [
      { category: "dried / dehydrated fruit", limit_mg_per_kg: 350 },
      { category: "sausages and comminuted meat", limit_mg_per_kg: 450 },
    ],
    what_happens_above_limit:
      "Sulphite-sensitive people — especially asthmatics — can get severe wheezing, chest tightness, flushing and, rarely, a life-threatening reaction from amounts over the limit. It also destroys thiamine (vitamin B1) in the food.",
    how_to_check:
      "Any packaged food with sulphites over 10 mg/kg must say 'Contains sulphites' or list E220–E228. A sharp, struck-match smell on opening a dried-fruit or juice pack suggests a heavy dose.",
  },
  {
    name: "Sulphur Dioxide",
    also_known_as: ["sulphur dioxide", "sulfur dioxide", "E220", "INS 220", "SO2", "added sulphites"],
    e_code: "E220",
    ins_code: "INS 220",
    category: "preservative",
    fssai_max_limit_mg_per_kg: 50,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — sulphur dioxide and sulphites table.",
    applies_to: ["fruit juices", "fruit-based beverages", "jam and fruit pulp"],
    special_limits: [
      { category: "dried fruit (apricots, raisins, figs)", limit_mg_per_kg: 350 },
      { category: "sugar and liquid glucose", limit_mg_per_kg: 70 },
    ],
    what_happens_above_limit:
      "Over the limit it triggers coughing, wheezing and breathlessness in asthmatics, and headaches, nausea and stomach upset in others. It also strips thiamine (vitamin B1) from the food.",
    how_to_check:
      "Must be declared as a sulphite allergen above 10 mg/kg. Unusually bright, long-lasting colour in dried apricots or raisins, and a pungent smell, point to heavy use.",
  },
  {
    name: "Nisin",
    also_known_as: ["nisin", "E234", "INS 234", "nisin preparation"],
    e_code: "E234",
    ins_code: "INS 234",
    category: "preservative",
    fssai_max_limit_mg_per_kg: 12.5,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — permitted for cheese and processed cheese only.",
    applies_to: ["cheese", "processed cheese", "paneer (where permitted)"],
    special_limits: [],
    what_happens_above_limit:
      "Nisin is a naturally occurring antibacterial peptide and is low-risk at food levels. The concern with routine over-use is the general worry that food-chain exposure to antimicrobials could nudge bacterial resistance.",
    how_to_check:
      "Only expected on cheese and processed cheese. Seeing 'nisin' / 'E234' on any other product is itself a red flag.",
  },
  {
    name: "Sodium Nitrite",
    also_known_as: ["sodium nitrite", "E250", "INS 250", "nitrite of soda", "curing salt (nitrite)"],
    e_code: "E250",
    ins_code: "INS 250",
    category: "preservative",
    fssai_max_limit_mg_per_kg: 200,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — nitrites/nitrates table for cured and processed meat.",
    applies_to: ["processed meat", "cured meat", "bacon, ham, sausages", "canned meat"],
    special_limits: [],
    what_happens_above_limit:
      "Above the limit, far more nitrosamines — among the most potent cancer-causing chemicals known — form when the meat is fried or grilled. Very high doses also stop the blood carrying oxygen properly (methaemoglobinaemia), which is especially dangerous for infants.",
    how_to_check:
      "The pack will not state mg/kg. A very uniform pink colour that survives cooking, and 'sodium nitrite' / 'E250' listed alongside 'sodium nitrate' / 'E251', suggest heavy curing.",
  },
  {
    name: "Sodium Nitrate",
    also_known_as: ["sodium nitrate", "E251", "INS 251", "nitrate of soda", "Chile saltpetre", "curing salt (nitrate)"],
    e_code: "E251",
    ins_code: "INS 251",
    category: "preservative",
    fssai_max_limit_mg_per_kg: 500,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — nitrites/nitrates table for cured meat and certain cheeses.",
    applies_to: ["cured meat", "dry-cured ham and salami", "some traditional cheeses"],
    special_limits: [],
    what_happens_above_limit:
      "Nitrate is steadily converted to nitrite in the body and in the product, so over the limit it carries the same rising nitrosamine and cancer risk, plus the infant oxygen-carrying risk.",
    how_to_check:
      "Not printed as a quantity. Its presence on anything other than cured meat or a named traditional cheese is unusual.",
  },
  {
    name: "Propionic Acid",
    also_known_as: ["propionic acid", "calcium propionate", "sodium propionate", "E280", "E282", "INS 280", "INS 282"],
    e_code: "E280",
    ins_code: "INS 280",
    category: "preservative",
    fssai_max_limit_mg_per_kg: 3000,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — propionic acid and its salts, bread and bakery table.",
    applies_to: ["bread", "buns and pav", "bakery products", "packaged rotis and wraps"],
    special_limits: [],
    what_happens_above_limit:
      "Propionate is well tolerated, but over the limit some people report headaches or stomach irritation, and a few small studies have linked high intakes in children to irritability and disturbed sleep.",
    how_to_check:
      "Bread that stays mould-free at room temperature for a week or more is likely near the top of the permitted range. Look for 'calcium propionate' / 'E282' early in the list.",
  },

  // ---- COLOURS ----
  {
    name: "Tartrazine",
    also_known_as: ["tartrazine", "E102", "INS 102", "FD&C Yellow 5", "CI 19140", "acid yellow 23"],
    e_code: "E102",
    ins_code: "INS 102",
    category: "color",
    fssai_max_limit_mg_per_kg: 100,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — permitted synthetic food colours table (100 mg/kg general ceiling).",
    applies_to: ["confectionery", "snacks and namkeen", "instant noodles", "desserts", "pickles"],
    special_limits: [{ category: "carbonated and non-carbonated beverages", limit_mg_per_kg: 50 }],
    what_happens_above_limit:
      "One of the 'Southampton Six' colours: higher intakes increase hyperactivity, restlessness and inattention in children, and can set off asthma, hives and nasal congestion, particularly in people sensitive to aspirin.",
    how_to_check:
      "An intense, uniform lemon-yellow with 'tartrazine' / 'E102' / 'colour (102)' listed. Indian rules also cap the total of all synthetic colours in a product at 100 mg/kg, so several bright colours together is a warning sign.",
  },
  {
    name: "Sunset Yellow FCF",
    also_known_as: ["sunset yellow", "sunset yellow FCF", "E110", "INS 110", "FD&C Yellow 6", "CI 15985", "orange yellow S"],
    e_code: "E110",
    ins_code: "INS 110",
    category: "color",
    fssai_max_limit_mg_per_kg: 100,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — permitted synthetic food colours table.",
    applies_to: ["confectionery", "packaged snacks", "instant desserts", "biscuits", "jams"],
    special_limits: [{ category: "carbonated and non-carbonated beverages", limit_mg_per_kg: 50 }],
    what_happens_above_limit:
      "Another Southampton-Six colour: raised intake is linked to hyperactivity and a shorter attention span in children, and to allergic skin reactions and stomach upset.",
    how_to_check:
      "A deep orange-yellow shade with 'sunset yellow' / 'E110' / 'colour (110)'. Watch for it stacked with tartrazine and other colours toward the 100 mg/kg total-colour cap.",
  },
  {
    name: "Carmoisine",
    also_known_as: ["carmoisine", "azorubine", "E122", "INS 122", "CI 14720", "acid red 14"],
    e_code: "E122",
    ins_code: "INS 122",
    category: "color",
    fssai_max_limit_mg_per_kg: 50,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — permitted synthetic food colours table (azo red, 50 mg/kg for many categories).",
    applies_to: ["confectionery", "flavoured yoghurt", "packaged juices and squashes", "cake mixes", "brown sauces"],
    special_limits: [],
    what_happens_above_limit:
      "A Southampton-Six azo red: over the limit it adds to hyperactivity and attention problems in children and can worsen asthma and hives, especially in aspirin-sensitive people. Azo dyes also release aromatic amines as they break down.",
    how_to_check:
      "A bright cherry-to-pink red with 'carmoisine' / 'azorubine' / 'E122'. It is banned in several countries, so its presence at all is worth noting.",
  },
  {
    name: "Ponceau 4R",
    also_known_as: ["ponceau 4R", "cochineal red A", "E124", "INS 124", "CI 16255", "brilliant scarlet 4R"],
    e_code: "E124",
    ins_code: "INS 124",
    category: "color",
    fssai_max_limit_mg_per_kg: 50,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — permitted synthetic food colours table (azo red).",
    applies_to: ["tinned fruit and cherries", "confectionery", "dessert mixes", "packaged juices", "cake decorations"],
    special_limits: [],
    what_happens_above_limit:
      "A Southampton-Six azo dye and a suspected carcinogen (not permitted in the USA or Norway). Over the limit it adds to child hyperactivity and can trigger asthma and hives.",
    how_to_check:
      "A scarlet-red shade listed as 'ponceau 4R' / 'E124'. Being banned in major markets, any amount is a reason for caution.",
  },
  {
    name: "Allura Red AC",
    also_known_as: ["allura red", "allura red AC", "E129", "INS 129", "FD&C Red 40", "CI 16035"],
    e_code: "E129",
    ins_code: "INS 129",
    category: "color",
    fssai_max_limit_mg_per_kg: 100,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — permitted synthetic food colours table.",
    applies_to: ["soft drinks", "confectionery and chewing gum", "breakfast cereals", "flavoured milk", "gelatin desserts"],
    special_limits: [],
    what_happens_above_limit:
      "Over the limit, this red is linked to hyperactivity and irritability in children and to hives and swelling; newer lab work suggests long-term high intake may irritate the gut lining and aggravate inflammatory bowel disease.",
    how_to_check:
      "A vivid, slightly orange red with 'allura red' / 'E129' / 'colour (129)'. Restricted in several European countries.",
  },
  {
    name: "Brilliant Blue FCF",
    also_known_as: ["brilliant blue", "brilliant blue FCF", "E133", "INS 133", "FD&C Blue 1", "CI 42090"],
    e_code: "E133",
    ins_code: "INS 133",
    category: "color",
    fssai_max_limit_mg_per_kg: 100,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — permitted synthetic food colours table.",
    applies_to: ["blue and green confectionery", "sports and energy drinks", "canned peas", "dairy desserts", "icing"],
    special_limits: [],
    what_happens_above_limit:
      "Lower risk than the red and yellow azo dyes, but over the limit it can cause hives or itching in sensitive people, and more may be absorbed through an inflamed gut. It is usually blended with tartrazine to make green, adding that dye's risks.",
    how_to_check:
      "A clean bright blue or, blended, a vivid green, with 'brilliant blue' / 'E133'. If green, tartrazine is almost certainly present too.",
  },
  {
    name: "Erythrosine",
    also_known_as: ["erythrosine", "E127", "INS 127", "FD&C Red 3", "CI 45430"],
    e_code: "E127",
    ins_code: "INS 127",
    category: "color",
    fssai_max_limit_mg_per_kg: 200,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — permitted only for glacé/candied cherries and cocktail/candied fruits.",
    applies_to: ["glacé and candied cherries", "cocktail fruits", "candied fruit"],
    special_limits: [],
    what_happens_above_limit:
      "Erythrosine is iodine-rich, so regular intake can disturb the thyroid gland and shift thyroid hormone levels; high doses caused thyroid tumours in animals. It is being withdrawn from food use in the USA.",
    how_to_check:
      "It is only legal in candied cherries and cocktail fruits. 'Erythrosine' / 'E127' on any other product — pink sweets, biscuits, dairy desserts — is a straight violation, regardless of amount.",
  },
  {
    name: "Caramel Colour",
    also_known_as: ["caramel colour", "caramel color", "E150", "E150a", "E150b", "E150c", "E150d", "INS 150a", "INS 150c", "INS 150d", "colour (150d)"],
    e_code: "E150",
    ins_code: "INS 150",
    category: "color",
    fssai_max_limit_mg_per_kg: null,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — caramel permitted at GMP; class III/IV (ammonia and ammonia-sulphite process) carry compositional limits.",
    applies_to: ["colas and soft drinks", "brown sauces and gravies", "beer and dark spirits", "bakery and confectionery"],
    special_limits: [],
    what_happens_above_limit:
      "There is no fixed number — it is a GMP colour — but visibly heavy use is a violation. The ammonia-process types (E150c / E150d, used in colas) carry 4-methylimidazole, a compound that caused cancer in animal studies, so a large daily cola habit is the real concern.",
    how_to_check:
      "A deep brown colour where 'caramel colour' / 'E150d' / 'colour (150d)' sits high in a short ingredients list suggests it is doing heavy lifting. Colas are the main source.",
  },

  // ---- SWEETENERS ----
  {
    name: "Aspartame",
    also_known_as: ["aspartame", "E951", "INS 951", "contains a source of phenylalanine", "aspartame-acesulfame salt"],
    e_code: "E951",
    ins_code: "INS 951",
    category: "sweetener",
    fssai_max_limit_mg_per_kg: 700,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — non-nutritive sweeteners table; mandatory PKU warning under the Labelling and Display Regulations, 2020.",
    applies_to: ["diet and zero soft drinks", "sugar-free chewing gum", "tabletop sweeteners", "flavoured waters"],
    special_limits: [
      { category: "sugar-free desserts, jellies and dairy", limit_mg_per_kg: 1000 },
      { category: "table-top sweetener (per portion basis)", limit_mg_per_kg: 2000 },
    ],
    what_happens_above_limit:
      "IARC classifies aspartame as 'possibly carcinogenic to humans' (Group 2B). People with the inherited condition PKU cannot process the phenylalanine it releases and can suffer brain damage; some people get aspartame-triggered headaches or migraine.",
    how_to_check:
      "Any product with aspartame must carry 'Contains a source of phenylalanine'. Compare a 600 ml bottle against the worked ADI below.",
    adi_mg_per_kg_body_weight: 40,
    example_calculation:
      "ADI 40 mg/kg body weight/day. A 60 kg adult should not exceed ~2,400 mg/day. A 600 ml diet drink at the 700 mg/l limit holds ~420 mg, so about 5–6 bottles a day would reach the limit; a small child hits it far sooner.",
  },
  {
    name: "Acesulfame Potassium",
    also_known_as: ["acesulfame potassium", "acesulfame K", "ace-K", "E950", "INS 950"],
    e_code: "E950",
    ins_code: "INS 950",
    category: "sweetener",
    fssai_max_limit_mg_per_kg: 600,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — non-nutritive sweeteners table.",
    applies_to: ["diet and zero soft drinks", "sugar-free gum", "protein powders and bars", "sugar-free dairy desserts"],
    special_limits: [{ category: "sugar-free confectionery and desserts", limit_mg_per_kg: 500 }],
    what_happens_above_limit:
      "The original safety database is thin and dated; newer animal work hints at effects on the thyroid, on gut bacteria and on the brain's appetite control. Like all intense sweeteners it sustains a craving for very sweet food.",
    how_to_check:
      "Listed as 'acesulfame K' / 'E950', very often paired with aspartame or sucralose. Compare the serving with the ADI below.",
    adi_mg_per_kg_body_weight: 15,
    example_calculation:
      "ADI 15 mg/kg body weight/day → about 900 mg/day for a 60 kg adult. A 600 ml drink at the 600 mg/l limit holds ~360 mg, so roughly 2–3 bottles a day reaches the limit.",
  },
  {
    name: "Sucralose",
    also_known_as: ["sucralose", "E955", "INS 955", "trichlorogalactosucrose", "Splenda (brand)"],
    e_code: "E955",
    ins_code: "INS 955",
    category: "sweetener",
    fssai_max_limit_mg_per_kg: 300,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — non-nutritive sweeteners table.",
    applies_to: ["diet soft drinks and flavoured waters", "sugar-free desserts and ice cream", "protein bars and shakes", "sugar-free syrups"],
    special_limits: [{ category: "sugar-free baked goods and desserts", limit_mg_per_kg: 700 }],
    what_happens_above_limit:
      "Above the limit, sucralose can reduce helpful gut bacteria, and heating it (baking, frying) can form chlorinated compounds called chloropropanols, some potentially harmful. Some studies link regular use to changes in blood-sugar and insulin response and to increased appetite.",
    how_to_check:
      "Listed as 'sucralose' / 'E955'. Compare the serving with the ADI below.",
    adi_mg_per_kg_body_weight: 15,
    example_calculation:
      "ADI 15 mg/kg body weight/day → about 900 mg/day for a 60 kg adult. A 600 ml drink at the 300 mg/l limit holds ~180 mg, so around 5 bottles a day would reach the limit.",
  },
  {
    name: "Saccharin",
    also_known_as: ["saccharin", "sodium saccharin", "E954", "INS 954", "saccharin sodium"],
    e_code: "E954",
    ins_code: "INS 954",
    category: "sweetener",
    fssai_max_limit_mg_per_kg: 100,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — non-nutritive sweeteners table.",
    applies_to: ["diet soft drinks", "tabletop sweetener tablets", "sugar-free sweets", "diabetic foods"],
    special_limits: [{ category: "table-top sweetener (per portion basis)", limit_mg_per_kg: 1200 }],
    what_happens_above_limit:
      "Saccharin caused bladder tumours in rats (later judged not clearly relevant to humans, so it stays permitted at low limits). It has a metallic aftertaste at higher doses and, like all intense sweeteners, keeps a very-sweet palate going.",
    how_to_check:
      "Listed as 'saccharin' / 'E954', usually blended with cyclamate or aspartame. Compare the serving with the ADI below.",
    adi_mg_per_kg_body_weight: 5,
    example_calculation:
      "ADI 5 mg/kg body weight/day → about 300 mg/day for a 60 kg adult. A 600 ml drink at the 100 mg/l limit holds ~60 mg, so around 5 bottles a day reaches the limit.",
  },
  {
    name: "Steviol Glycosides",
    also_known_as: ["steviol glycosides", "stevia", "E960", "INS 960", "rebaudioside A", "stevioside"],
    e_code: "E960",
    ins_code: "INS 960",
    category: "sweetener",
    fssai_max_limit_mg_per_kg: 200,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — steviol glycosides table (limits expressed as steviol equivalents).",
    applies_to: ["'naturally sweetened' soft drinks", "sugar-free dairy and desserts", "tabletop sweeteners", "sugar-free confectionery"],
    special_limits: [{ category: "sugar-free confectionery and desserts", limit_mg_per_kg: 350 }],
    what_happens_above_limit:
      "Stevia is plant-derived and generally well tolerated, but it still has an ADI. Very high intakes can cause bloating, nausea or a transient drop in blood pressure, and the intensely sweet taste still trains a preference for sweetness.",
    how_to_check:
      "Listed as 'steviol glycosides' / 'stevia' / 'E960'. 'Natural' on the front of pack does not remove the limit — compare the serving with the ADI below.",
    adi_mg_per_kg_body_weight: 4,
    example_calculation:
      "ADI 4 mg/kg body weight/day as steviol → about 240 mg steviol/day for a 60 kg adult (roughly 600 mg of steviol glycosides). A 600 ml drink at the 200 mg/l limit holds ~120 mg of glycosides.",
  },

  // ---- ANTIOXIDANTS ----
  {
    name: "BHA",
    also_known_as: ["BHA", "butylated hydroxyanisole", "E320", "INS 320"],
    e_code: "E320",
    ins_code: "INS 320",
    category: "antioxidant",
    fssai_max_limit_mg_per_kg: 200,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — antioxidants table (limit expressed on the fat/oil content of the product).",
    applies_to: ["fats and oils", "fried snacks and namkeen", "instant noodles", "chewing gum", "biscuits"],
    special_limits: [],
    what_happens_above_limit:
      "The US National Toxicology Program lists BHA as 'reasonably anticipated to be a human carcinogen' — it caused forestomach tumours in rats and hamsters — and it acts as a weak hormone (oestrogen-mimicking) disruptor. It builds up in body fat.",
    how_to_check:
      "Listed as 'BHA' / 'E320', usually as 'antioxidant (320)', often together with BHT. The limit is per unit of fat, so oily fried snacks are the ones to watch.",
  },
  {
    name: "BHT",
    also_known_as: ["BHT", "butylated hydroxytoluene", "E321", "INS 321"],
    e_code: "E321",
    ins_code: "INS 321",
    category: "antioxidant",
    fssai_max_limit_mg_per_kg: 200,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — antioxidants table (limit on the fat/oil content).",
    applies_to: ["fats and oils", "breakfast cereals", "chewing gum", "packaged baked goods", "dehydrated potato products"],
    special_limits: [],
    what_happens_above_limit:
      "Animal data are mixed — liver enlargement, thyroid changes and tumour-promoting effects in some studies — so regulators treat BHT as a possible but unproven human carcinogen. It disrupts hormones in lab tests and lingers in body fat.",
    how_to_check:
      "Listed as 'BHT' / 'E321' / 'antioxidant (321)', frequently alongside BHA — which doubles the exposure. Judge against the fat content of the food.",
  },
  {
    name: "TBHQ",
    also_known_as: ["TBHQ", "tertiary butylhydroquinone", "tert-butylhydroquinone", "E319", "INS 319"],
    e_code: "E319",
    ins_code: "INS 319",
    category: "antioxidant",
    fssai_max_limit_mg_per_kg: 200,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — antioxidants table (limit on the fat/oil content).",
    applies_to: ["frying oils", "potato and corn snacks", "instant noodles", "biscuits and crackers", "microwave popcorn"],
    special_limits: [],
    what_happens_above_limit:
      "TBHQ is potent — around 5 g eaten at once can be fatal, causing nausea, vomiting, ringing in the ears, delirium and collapse. Animal studies show forestomach tumours, DNA damage and enlarged livers; newer work suggests it can weaken the immune response and promote food allergies.",
    how_to_check:
      "Listed as 'TBHQ' / 'E319' / 'antioxidant (319)'. Reused frying oil in packaged snacks is the classic source; the limit is per unit of fat.",
  },
  {
    name: "Ascorbic Acid",
    also_known_as: ["ascorbic acid", "vitamin C", "L-ascorbic acid", "E300", "INS 300", "sodium ascorbate", "antioxidant (300)"],
    e_code: "E300",
    ins_code: "INS 300",
    category: "antioxidant",
    fssai_max_limit_mg_per_kg: null,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — ascorbic acid permitted at GMP.",
    applies_to: ["fruit juices and drinks", "cured meat", "bakery (as a flour improver)", "'fortified with vitamin C' products"],
    special_limits: [],
    what_happens_above_limit:
      "Vitamin C is safe on its own and has no fixed limit. The danger is combination: in the same product as any benzoate preservative (E210–E213) it can react to form benzene, a known human leukaemia-causing chemical — and that risk exists at essentially any amount, rising with heat, light and shelf time.",
    how_to_check:
      "Scan the whole ingredients list: if 'ascorbic acid' / 'vitamin C' / 'E300' appears together with 'sodium benzoate' / 'E211' (or E210 / E212 / E213), treat the product as a benzene-formation risk regardless of the stated quantities.",
  },

  // ---- EMULSIFIERS ----
  {
    name: "Polysorbate 80",
    also_known_as: ["polysorbate 80", "polyoxyethylene sorbitan monooleate", "Tween 80", "E433", "INS 433"],
    e_code: "E433",
    ins_code: "INS 433",
    category: "emulsifier",
    fssai_max_limit_mg_per_kg: 1000,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — emulsifiers and stabilisers table (polysorbates).",
    applies_to: ["ice cream and frozen desserts", "whipped toppings and non-dairy creamer", "sauces and dressings", "packaged cake and icing"],
    special_limits: [],
    what_happens_above_limit:
      "Above the limit, animal studies and early human data link polysorbate 80 to a thinner protective gut-mucus layer, bacteria getting closer to the gut wall, low-grade inflammation, weight gain and worse blood-sugar control. It can rarely cause serious allergic reactions.",
    how_to_check:
      "Listed as 'polysorbate 80' / 'E433'. Smooth, slow-melting ice cream with a long ingredient list is the typical carrier.",
  },
  {
    name: "Carboxymethyl Cellulose",
    also_known_as: ["carboxymethyl cellulose", "sodium carboxymethyl cellulose", "cellulose gum", "CMC", "E466", "INS 466"],
    e_code: "E466",
    ins_code: "INS 466",
    category: "emulsifier",
    fssai_max_limit_mg_per_kg: 5000,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — emulsifiers, stabilisers and thickeners table (celluloses).",
    applies_to: ["ice cream", "flavoured milk and shakes", "sauces and ketchup", "bakery fillings", "gluten-free products"],
    special_limits: [],
    what_happens_above_limit:
      "The limit is generous, but recent controlled trials link dietary CMC to altered gut bacteria and low-grade intestinal inflammation even at intakes below the limit, so 'within limit' is not a full all-clear.",
    how_to_check:
      "Listed as 'cellulose gum' / 'CMC' / 'E466' / 'stabiliser (466)'. Common in cheap ice cream and thickened flavoured milk.",
  },
  {
    name: "Lecithin",
    also_known_as: ["lecithin", "soya lecithin", "soy lecithin", "sunflower lecithin", "E322", "INS 322", "emulsifier (322)"],
    e_code: "E322",
    ins_code: "INS 322",
    category: "emulsifier",
    fssai_max_limit_mg_per_kg: null,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — lecithin permitted at GMP.",
    applies_to: ["chocolate and confectionery", "baked goods", "margarine and spreads", "infant formula", "instant drink powders"],
    special_limits: [],
    what_happens_above_limit:
      "Lecithin is a normal component of food (egg yolk, soybeans) and is considered safe with no fixed limit. Soya-derived lecithin should be declared for people with soy allergy.",
    how_to_check:
      "Listed as 'lecithin' / 'soya lecithin' / 'E322'. If soy-derived, it must appear in the allergen advice.",
  },

  // ---- ACIDITY REGULATORS ----
  {
    name: "Phosphoric Acid",
    also_known_as: ["phosphoric acid", "orthophosphoric acid", "E338", "INS 338", "acidity regulator (338)"],
    e_code: "E338",
    ins_code: "INS 338",
    category: "acidity_regulator",
    fssai_max_limit_mg_per_kg: 700,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — phosphoric acid and phosphates table for beverages.",
    applies_to: ["colas and soft drinks", "some flavoured waters"],
    special_limits: [],
    what_happens_above_limit:
      "A high cola intake is linked to lower bone mineral density, because excess phosphate pulls calcium out of bone, and to tooth-enamel erosion from the acidity. Children and post-menopausal women are most affected.",
    how_to_check:
      "Listed as 'phosphoric acid' / 'E338' / 'acidity regulator (338)' — essentially only in colas. Several colas a day is the concern.",
  },
  {
    name: "Citric Acid",
    also_known_as: ["citric acid", "E330", "INS 330", "acidity regulator (330)", "acid (330)"],
    e_code: "E330",
    ins_code: "INS 330",
    category: "acidity_regulator",
    fssai_max_limit_mg_per_kg: null,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — citric acid permitted at GMP.",
    applies_to: ["soft drinks and juices", "jams and preserves", "confectionery", "canned vegetables", "ready meals"],
    special_limits: [],
    what_happens_above_limit:
      "Citric acid is safe and has no fixed limit, but heavy use erodes tooth enamel over time and can be used to mask the sourness of a product that is starting to spoil.",
    how_to_check:
      "Listed as 'citric acid' / 'E330' — extremely common. It is only a concern in very acidic sipped drinks consumed all day.",
  },

  // ---- FLAVOUR ENHANCERS ----
  {
    name: "Monosodium Glutamate",
    also_known_as: ["monosodium glutamate", "MSG", "E621", "INS 621", "flavour enhancer (621)", "ajinomoto", "added MSG"],
    e_code: "E621",
    ins_code: "INS 621",
    category: "flavor_enhancer",
    fssai_max_limit_mg_per_kg: 10000,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — flavour enhancers table (10 g/kg for many categories); added MSG prohibited in food for infants and young children and must be declared on the label.",
    applies_to: ["instant noodles and seasoning sachets", "chips and namkeen", "soup and gravy mixes", "stock cubes", "ready-to-eat snacks"],
    special_limits: [],
    what_happens_above_limit:
      "The 10 g/kg ceiling is high; the practical issue is that sensitive people report headache, flushing, sweating and chest tightness, sometimes well below the limit, and MSG adds a large hidden sodium load and makes salty, fatty food easy to over-eat.",
    how_to_check:
      "Labels must say 'added monosodium glutamate' / 'E621'. 'No added MSG' packs may still carry free glutamate from 'hydrolysed vegetable protein' or 'yeast extract'. It must never appear on infant or young-child food.",
  },
  {
    name: "Disodium Guanylate",
    also_known_as: ["disodium guanylate", "sodium 5'-guanylate", "E627", "INS 627", "flavour enhancer (627)"],
    e_code: "E627",
    ins_code: "INS 627",
    category: "flavor_enhancer",
    fssai_max_limit_mg_per_kg: 500,
    fssai_regulation_reference:
      "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011 — flavour enhancers table (ribonucleotides, expressed as guanylic acid).",
    applies_to: ["instant noodles and seasoning", "savoury snacks", "soup and gravy mixes", "flavoured crackers"],
    special_limits: [],
    what_happens_above_limit:
      "Disodium guanylate is almost always used together with MSG to boost the savoury hit, so its presence signals a high overall glutamate/umami-additive load. It is a purine, so people with gout or on a low-purine diet should limit it.",
    how_to_check:
      "Listed as 'disodium guanylate' / 'E627', nearly always next to 'disodium inosinate' (E631) and MSG — the trio 'E621, E627, E631' together is the marker of a heavily seasoned product.",
  },
];

/** Look up an FSSAI additive-limit entry by name, alias, or E/INS code (case-insensitive). */
export function findAdditiveLimit(name: string): FssaiAdditiveLimit | undefined {
  const n = name?.toLowerCase().trim();
  if (!n) return undefined;
  return (
    FSSAI_ADDITIVE_LIMITS.find(
      (a) =>
        a.name.toLowerCase() === n ||
        a.e_code?.toLowerCase() === n ||
        a.ins_code?.toLowerCase() === n ||
        a.also_known_as.some((x) => x.toLowerCase() === n),
    ) ??
    FSSAI_ADDITIVE_LIMITS.find(
      (a) =>
        n.includes(a.name.toLowerCase()) ||
        a.name.toLowerCase().includes(n) ||
        a.also_known_as.some(
          (x) => x.length > 3 && n.includes(x.toLowerCase()),
        ),
    )
  );
}

// ============================================================================
// 6. REFERENCE METADATA
// ============================================================================

export const REFERENCE_METADATA = {
  version: "1.0.0",
  last_updated: "2026-09-07",
  disclaimer:
    "This knowledge base is for consumer education and preliminary screening only. It is not legal advice or a lab test. Regulatory limits change; verify against the current FSSAI and Legal Metrology notifications before acting.",
  legal_references: [
    "Legal Metrology Act, 2009",
    "Legal Metrology (Packaged Commodities) Rules, 2011 — especially Rules 6, 7 and 9",
    "Food Safety and Standards Act, 2006",
    "Food Safety and Standards (Packaging and Labelling) Regulations, 2011",
    "Food Safety and Standards (Labelling and Display) Regulations, 2020",
    "Food Safety and Standards (Food Products Standards and Food Additives) Regulations, 2011",
    "Food Safety and Standards (Prohibition and Restrictions on Sales) Regulations, 2011",
    "Food Safety and Standards (Contaminants, Toxins and Residues) Regulations, 2011",
  ],
  sources: [
    { name: "FSSAI (Food Safety and Standards Authority of India)", url: "https://www.fssai.gov.in" },
    { name: "FSSAI DART book — Detect Adulteration with Rapid Test", url: "https://fssai.gov.in/dart" },
    { name: "Department of Consumer Affairs — Legal Metrology", url: "https://consumeraffairs.nic.in" },
    { name: "WHO / IARC Monographs on the identification of carcinogenic hazards", url: "https://monographs.iarc.who.int" },
    { name: "European Food Safety Authority (EFSA)", url: "https://www.efsa.europa.eu" },
    { name: "US Food and Drug Administration — Food Additives & Ingredients", url: "https://www.fda.gov/food/food-additives-petitions" },
    { name: "McCann et al., 2007 (Lancet) — the 'Southampton Six' food-colour study", url: "https://www.thelancet.com" },
  ],
  complaint_portals: {
    fssai_food_safety_connect: "https://foodlicensing.fssai.gov.in/cmsweb/ (Food Safety Connect — also on the 'Food Safety Connect' mobile app)",
    fssai_foscos: "https://foscos.fssai.gov.in",
    national_consumer_helpline: "https://consumerhelpline.gov.in",
    national_consumer_helpline_number: "1915 (toll-free) / WhatsApp 8800001915",
    ingram_portal: "https://consumerhelpline.gov.in (INGRAM — Integrated Grievance Redressal Mechanism)",
    e_daakhil: "https://edaakhil.nic.in (file consumer commission cases online)",
    legal_metrology_departments:
      "State Legal Metrology / Weights & Measures department — links from https://consumeraffairs.nic.in",
    jago_grahak_jago: "https://jagograhakjago.gov.in",
  },
};

// ============================================================================
// 7. PRODUCT-CATEGORY-SPECIFIC SAFETY DATA
// ============================================================================
// HealthRepo scans EVERY kind of packaged product, not just food. Each broad
// category is governed by a different law and a different regulator, bans a
// different set of ingredients, and needs a different label checklist. The
// /api/analyze prompt detects the category first (PHASE 1) and then applies the
// matching rules from here (PHASE 2).

export interface ProductCategoryRule {
  regulatory_body: string;
  act: string;
  complaint_portal: string;
  required_labels: string[];
  additional_checks: string[];
}

/** Broad regulatory buckets. Keyed by the `detected_category` id the model returns. */
export const PRODUCT_CATEGORY_RULES: Record<string, ProductCategoryRule> = {
  food_and_beverages: {
    regulatory_body: "FSSAI (Food Safety and Standards Authority of India)",
    act: "Food Safety and Standards Act, 2006",
    complaint_portal: "https://foscos.fssai.gov.in/consumergrievance",
    required_labels: [
      "FSSAI license number",
      "Ingredients list in descending order",
      "Nutritional info table",
      "Veg/Non-veg symbol",
      "Allergen declaration",
      "Best before/Use by date",
      "MRP",
      "Net weight",
      "Manufacturer details",
    ],
    additional_checks: [
      "Check against FSSAI banned ingredients",
      "Check additive limits",
      "Check trans fat limit (max 2%)",
      "Verify FSSAI 14-digit license format",
    ],
  },

  personal_care: {
    regulatory_body: "CDSCO (Central Drugs Standard Control Organisation) and BIS",
    act: "Drugs and Cosmetics Act, 1940 and BIS standards",
    complaint_portal:
      "https://cdsco.gov.in/opencms/opencms/en/consumer-corner/",
    required_labels: [
      "Batch/Lot number",
      "Manufacturing date",
      "Expiry/Best before date",
      "MRP",
      "Net quantity",
      "Manufacturer name and address",
      "Ingredients list",
      "Directions for use",
      "Warnings/Cautions",
      "IS/ISO certification mark (if applicable)",
    ],
    additional_checks: [
      "Check against banned cosmetic ingredients",
      "Check for carcinogenic compounds",
      "Check for allergens",
      "Verify no prohibited heavy metals",
    ],
  },

  household_cleaning: {
    regulatory_body: "BIS (Bureau of Indian Standards)",
    act: "Bureau of Indian Standards Act, 2016",
    complaint_portal: "https://consumerhelpline.gov.in",
    required_labels: [
      "Batch number",
      "Manufacturing date",
      "MRP",
      "Net quantity",
      "Manufacturer details",
      "Directions for use",
      "Safety warnings",
      "First aid instructions",
      "Hazard symbols (if applicable)",
      "Keep out of reach of children warning",
    ],
    additional_checks: [
      "Check for banned chemicals",
      "Check for corrosive/toxic warnings",
      "Verify safety data",
    ],
  },

  // Baby products inherit their parent regulator (food -> FSSAI, care -> CDSCO)
  // but add the extra labels and the zero-tolerance checks. These are real keys
  // rather than a single `baby_products` bucket so that buildCompactReference()
  // and /api/analyze can look a baby category up directly.
  baby_product_food: {
    regulatory_body: "FSSAI (Food Safety and Standards Authority of India)",
    act: "Food Safety and Standards Act, 2006 (infant-food provisions)",
    complaint_portal: "https://foscos.fssai.gov.in/consumergrievance",
    required_labels: [
      "FSSAI license number",
      "Ingredients list in descending order",
      "Nutritional info table",
      "Veg/Non-veg symbol",
      "Allergen declaration",
      "Best before/Use by date",
      "MRP",
      "Net weight",
      "Manufacturer details",
      "Age recommendation (e.g. 'for infants above 6 months')",
      "Mandatory breastfeeding statement for infant milk substitutes",
      "Preparation and storage instructions",
    ],
    additional_checks: [
      "ZERO tolerance for banned ingredients",
      "Stricter limits on all additives",
      "No artificial sweeteners",
      "No artificial colors",
      "Check against EU baby food standards (stricter than India)",
      "Verify FSSAI 14-digit license format",
    ],
  },

  baby_product_care: {
    regulatory_body: "CDSCO (Central Drugs Standard Control Organisation) and BIS",
    act: "Drugs and Cosmetics Act, 1940 (children's cosmetics provisions)",
    complaint_portal:
      "https://cdsco.gov.in/opencms/opencms/en/consumer-corner/",
    required_labels: [
      "Batch/Lot number",
      "Manufacturing date",
      "Expiry/Best before date",
      "MRP",
      "Net quantity",
      "Manufacturer name and address",
      "Ingredients list",
      "Directions for use",
      "Warnings/Cautions",
      "Age suitability statement",
      "Paediatric / dermatological test statement where claimed",
    ],
    additional_checks: [
      "ZERO tolerance for banned cosmetic ingredients",
      "No parabens, formaldehyde donors or phthalates in infant products",
      "Check for allergens and undisclosed fragrance",
      "Verify no prohibited heavy metals",
      "Check against EU children's-cosmetics standards (stricter than India)",
    ],
  },
};

export interface PersonalCareBannedIngredient {
  name: string;
  why_banned: string;
  health_effects: string;
  found_in: string[];
  severity: "critical" | "high" | "medium";
}

/** Ingredients banned or tightly restricted in cosmetics / personal care in India. */
export const PERSONAL_CARE_BANNED_INGREDIENTS: PersonalCareBannedIngredient[] = [
  {
    name: "Mercury and mercury compounds",
    why_banned:
      "Highly toxic heavy metal. Causes kidney damage, nervous system damage, skin irritation. Banned in skin lightening creams.",
    health_effects:
      "Mercury accumulates in the body. Causes tremors, memory loss, kidney failure. Particularly dangerous during pregnancy — causes birth defects.",
    found_in: [
      "skin lightening creams",
      "fairness creams",
      "anti-aging creams",
    ],
    severity: "critical",
  },
  {
    name: "Hydroquinone (above 2%)",
    why_banned:
      "Banned in OTC cosmetics above 2% concentration. Causes ochronosis (permanent blue-black skin darkening), liver damage.",
    health_effects:
      "Causes irreversible skin damage called exogenous ochronosis. Linked to liver and kidney damage. May be carcinogenic.",
    found_in: ["skin lightening products", "spot treatment creams"],
    severity: "critical",
  },
  {
    name: "Lead acetate",
    why_banned:
      "Toxic heavy metal compound. Banned in hair dyes and cosmetics.",
    health_effects:
      "Lead is a cumulative neurotoxin. Causes brain damage, especially in children. Damages kidneys and reproductive system.",
    found_in: ["some hair dyes", "kohl/kajal"],
    severity: "critical",
  },
  {
    name: "Formaldehyde and formaldehyde releasers (above 0.2%)",
    why_banned:
      "Carcinogenic preservative. Allowed below 0.2% but many products exceed this.",
    health_effects:
      "Confirmed carcinogen (IARC Group 1). Causes skin irritation, respiratory issues, and allergic reactions. Found as DMDM Hydantoin, Quaternium-15, Imidazolidinyl Urea on labels.",
    found_in: [
      "shampoos",
      "body washes",
      "nail polish",
      "hair straightening treatments",
    ],
    severity: "critical",
  },
  {
    name: "Parabens (Propylparaben, Butylparaben, Isopropylparaben, Isobutylparaben)",
    why_banned: "Restricted/banned in many countries. Endocrine disruptors.",
    health_effects:
      "Mimic estrogen in the body. Linked to breast cancer, reproductive issues, and hormonal imbalance. EU has banned several types.",
    found_in: ["shampoos", "conditioners", "lotions", "face creams"],
    severity: "high",
  },
  {
    name: "Triclosan",
    why_banned:
      "Banned by FDA in consumer antiseptic products. Endocrine disruptor.",
    health_effects:
      "Disrupts thyroid function, contributes to antibiotic resistance, may promote cancer. Harmful to aquatic life.",
    found_in: ["antibacterial soaps", "hand sanitizers", "toothpaste"],
    severity: "high",
  },
  {
    name: "Diethanolamine (DEA), Triethanolamine (TEA), Monoethanolamine (MEA)",
    why_banned:
      "Can react with other ingredients to form carcinogenic nitrosamines.",
    health_effects:
      "Skin irritation, organ toxicity. When combined with nitrites (common in cosmetics), forms cancer-causing nitrosamines.",
    found_in: ["shampoos", "body washes", "facial cleansers"],
    severity: "high",
  },
  {
    name: "Phthalates (DBP, DEHP, DEP)",
    why_banned: "Endocrine disruptors. Banned in EU cosmetics.",
    health_effects:
      "Disrupt hormones, linked to reproductive problems, birth defects, and early puberty. Often hidden under 'fragrance' on labels.",
    found_in: [
      "nail polish",
      "hair sprays",
      "perfumes",
      "any product listing 'fragrance'",
    ],
    severity: "high",
  },
  {
    name: "Toluene",
    why_banned: "Toxic solvent. Restricted in cosmetics.",
    health_effects:
      "Causes headaches, dizziness, respiratory issues. Can damage liver, kidneys, and nervous system. Harmful to developing fetuses.",
    found_in: ["nail polish", "hair dyes"],
    severity: "high",
  },
  {
    name: "Coal tar dyes (P-Phenylenediamine above limits)",
    why_banned: "Carcinogenic. Causes severe allergic reactions.",
    health_effects:
      "Causes skin allergies, asthma, cancer risk. PPD in hair dyes causes severe dermatitis in sensitive individuals.",
    found_in: ["hair dyes", "dark-colored cosmetics"],
    severity: "high",
  },
  {
    name: "Microbeads (plastic microbeads)",
    why_banned: "Banned in India since 2020 for environmental damage.",
    health_effects:
      "Don't biodegrade, enter water supply, consumed by marine life. Enter human food chain.",
    found_in: ["exfoliating face washes", "scrubs", "toothpaste"],
    severity: "critical",
  },
  {
    name: "Petroleum jelly / Mineral oil (low grade)",
    why_banned: "Low-grade mineral oil contains carcinogenic PAHs.",
    health_effects:
      "Low-grade versions contain polycyclic aromatic hydrocarbons (carcinogenic). Clogs pores, prevents skin from breathing.",
    found_in: ["moisturizers", "lip balms", "baby oil"],
    severity: "medium",
  },
];

export interface PersonalCareHarmfulAdditive {
  name: string;
  concern_level: "low" | "medium" | "high";
  why_concerning: string;
  who_should_avoid: string;
  healthier_alternative: string;
}

/** Legal in personal care, but worth flagging as 'caution'. */
export const PERSONAL_CARE_HARMFUL_ADDITIVES: PersonalCareHarmfulAdditive[] = [
  {
    name: "Sodium Lauryl Sulfate (SLS)",
    concern_level: "medium",
    why_concerning:
      "Strong detergent that strips natural oils. Causes skin and eye irritation. Not toxic but unnecessarily harsh.",
    who_should_avoid: "People with eczema, sensitive skin, dry hair",
    healthier_alternative:
      "Sodium Lauryl Sulfoacetate (SLSA), Cocamidopropyl Betaine, Decyl Glucoside",
  },
  {
    name: "Sodium Laureth Sulfate (SLES)",
    concern_level: "medium",
    why_concerning:
      "Milder than SLS but can be contaminated with 1,4-dioxane (a carcinogen) during manufacturing.",
    who_should_avoid: "Sensitive skin, children",
    healthier_alternative: "Coco-glucoside, Lauryl Glucoside",
  },
  {
    name: "Synthetic fragrances (listed as 'Fragrance' or 'Parfum')",
    concern_level: "high",
    why_concerning:
      "Can contain hundreds of undisclosed chemicals including phthalates and allergens. Companies aren't required to list what's inside 'fragrance'.",
    who_should_avoid:
      "Everyone — prefer products listing actual essential oils",
    healthier_alternative:
      "Products listing specific essential oils or 'fragrance-free'",
  },
  {
    name: "Silicones (Dimethicone, Cyclomethicone)",
    concern_level: "low",
    why_concerning:
      "Not toxic but coat hair/skin, preventing moisture. Build up over time.",
    who_should_avoid: "People with fine or thin hair",
    healthier_alternative: "Argan oil, jojoba oil, shea butter",
  },
  {
    name: "Artificial colors (FD&C dyes, CI numbers)",
    concern_level: "medium",
    why_concerning:
      "Serve no functional purpose in personal care. Some are derived from coal tar or petroleum.",
    who_should_avoid: "Sensitive skin, children",
    healthier_alternative:
      "Products without added colors, or those using natural colorants",
  },
  {
    name: "Propylene Glycol",
    concern_level: "low",
    why_concerning:
      "Generally safe but can cause irritation in sensitive individuals at high concentrations.",
    who_should_avoid: "People with very sensitive or broken skin",
    healthier_alternative: "Vegetable glycerin",
  },
  {
    name: "Aluminum compounds (in antiperspirants)",
    concern_level: "medium",
    why_concerning:
      "Blocks sweat glands. Debated links to breast cancer and Alzheimer's (not conclusive but concerning).",
    who_should_avoid: "Those who prefer precautionary approach",
    healthier_alternative:
      "Natural deodorants with baking soda, charcoal, or magnesium",
  },
  {
    name: "Oxybenzone (Benzophenone-3)",
    concern_level: "high",
    why_concerning:
      "Chemical sunscreen that disrupts hormones. Banned in Hawaii for coral reef damage. Absorbed through skin into bloodstream.",
    who_should_avoid:
      "Children, pregnant women, everyone if mineral alternatives available",
    healthier_alternative:
      "Zinc oxide or titanium dioxide based mineral sunscreens",
  },
  {
    name: "BHA and BHT in cosmetics",
    concern_level: "high",
    why_concerning:
      "Same antioxidants that are concerning in food. Endocrine disruptors. Classified as possible carcinogens.",
    who_should_avoid: "Everyone",
    healthier_alternative: "Vitamin E (tocopherol), rosemary extract",
  },
];

export interface HouseholdProductSafetyEntry {
  name: string;
  concern_level: "low" | "medium" | "high";
  why_concerning: string;
  safety_note: string;
  healthier_alternative: string;
}

/** Concerning chemicals in household cleaning products. */
export const HOUSEHOLD_PRODUCT_SAFETY: HouseholdProductSafetyEntry[] = [
  {
    name: "Chlorine bleach (Sodium Hypochlorite)",
    concern_level: "high",
    why_concerning:
      "Produces toxic chlorine gas. NEVER mix with ammonia or acids — creates lethal gas.",
    safety_note: "Use in ventilated areas, wear gloves",
    healthier_alternative:
      "Hydrogen peroxide based cleaners, oxygen bleach",
  },
  {
    name: "Ammonia",
    concern_level: "high",
    why_concerning:
      "Irritates lungs, eyes. NEVER mix with bleach — produces chloramine gas which can be fatal.",
    safety_note: "Use in well-ventilated areas only",
    healthier_alternative: "White vinegar, baking soda",
  },
  {
    name: "Phosphates",
    concern_level: "medium",
    why_concerning:
      "Causes water pollution and algal blooms. Banned in many countries for dishwasher/laundry detergents.",
    safety_note: "Environmental concern more than health",
    healthier_alternative: "Phosphate-free detergents",
  },
  {
    name: "Synthetic fragrances in cleaners",
    concern_level: "medium",
    why_concerning:
      "Same undisclosed chemical concerns as in personal care. Volatile organic compounds released into home air.",
    safety_note: "Ventilate well when using",
    healthier_alternative:
      "Fragrance-free cleaners, or those using essential oils",
  },
  {
    name: "2-Butoxyethanol",
    concern_level: "high",
    why_concerning:
      "Found in many multipurpose cleaners. Causes sore throat, narcosis, liver and kidney damage at high exposure.",
    safety_note: "Not required to be listed on labels in India",
    healthier_alternative: "Vinegar-based cleaners",
  },
];

// ============================================================================
// 8. COMPACT REFERENCE BUILDER  (performance-critical)
// ============================================================================
// Everything above carries multi-sentence why_banned / health_effects_detailed
// / who_should_avoid / how_to_identify prose. Stringified whole it is ~50k
// tokens, and it was being sent on EVERY /api/analyze call regardless of what
// kind of product was scanned.
//
// Claude does not need the prose to do the route's job — it needs just enough
// to IDENTIFY an ingredient on a label and CLASSIFY it. The long explanations
// are re-attached locally afterwards by lib/enrich-analysis.ts, so the user
// still sees them; they just aren't regenerated by the API every time.
//
// buildCompactReference(category) returns a MINIMAL, category-scoped slice:
//   banned ingredients  -> { name, also_known_as?, e_code?, severity }
//   harmful additives   -> { name, e_code?, ins_code?, concern_level, fssai_max_limit_mg_per_kg? }
//   FSSAI limits        -> name/codes + the limit numbers only (no prose)
//   Legal Metrology     -> { declaration, requirement }  (names + one-liners, no penalty/details text)
// A food scan never receives the personal-care or household lists, and vice
// versa. This drops the reference payload to well under 6k tokens.

export type CompactReferenceCategory =
  | "food_and_beverages"
  | "personal_care"
  | "household_cleaning"
  | "baby_product_food"
  | "baby_product_care"
  | "unknown";

/**
 * Map any loose category string — including the Haiku router's
 * 'not_a_packaged_product' — onto one of the known buckets.
 */
export function normalizeCompactCategory(v: string): CompactReferenceCategory {
  const s = (v || "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (
    s === "food_and_beverages" ||
    s === "personal_care" ||
    s === "household_cleaning" ||
    s === "baby_product_food" ||
    s === "baby_product_care"
  ) {
    return s;
  }
  if (
    s.includes("baby") &&
    (s.includes("care") ||
      s.includes("cosmetic") ||
      s.includes("lotion") ||
      s.includes("oil") ||
      s.includes("wash") ||
      s.includes("powder"))
  ) {
    return "baby_product_care";
  }
  if (s.includes("baby") || s.includes("infant")) return "baby_product_food";
  if (
    s.includes("household") ||
    s.includes("cleaning") ||
    s.includes("cleaner") ||
    s.includes("detergent")
  ) {
    return "household_cleaning";
  }
  if (s.includes("personal") || s.includes("cosmetic") || s.includes("care"))
    return "personal_care";
  if (s.includes("food") || s.includes("beverage") || s.includes("drink"))
    return "food_and_beverages";
  return "unknown";
}

export interface CompactReference {
  category: CompactReferenceCategory;
  regulatory: {
    regulatory_body: string;
    act: string;
    complaint_portal: string;
    required_labels: string[];
    additional_checks: string[];
  };
  banned_ingredients: {
    name: string;
    severity: string;
    also_known_as?: string[];
    e_code?: string | null;
  }[];
  harmful_additives: {
    name: string;
    concern_level: string;
    e_code?: string | null;
    ins_code?: string | null;
    fssai_max_limit_mg_per_kg?: number | null;
  }[];
  fssai_limits?: {
    name: string;
    also_known_as: string[];
    e_code: string | null;
    ins_code: string | null;
    category: string;
    fssai_max_limit_mg_per_kg: number | null;
    special_limits: { category: string; limit_mg_per_kg: number }[];
    adi_mg_per_kg_body_weight: number | null;
  }[];
  legal_metrology?: { declaration: string; requirement: string }[];
  labelling_rules?: string[];
  household_safety?: { name: string; concern_level: string; safety_note: string }[];
  /** Food only — names + aliases + penalties, no prose (see NUTRITIONAL_CONCERNS). */
  nutritional_concerns?: {
    name: string;
    also_known_as: string[];
    concern_type: string;
    concern_level: string;
    score_penalty: number;
  }[];
  /** Food only — the per-100 g / per-100 ml bands. */
  nutritional_thresholds?: typeof NUTRITIONAL_THRESHOLDS;
  stricter_thresholds_note?: string;
}

export function buildCompactReference(category: string): CompactReference {
  const cat = normalizeCompactCategory(category);
  // 'unknown' is treated as a food scan for reference purposes — that list is
  // the broadest and the Legal Metrology rules apply to every packaged good.
  const foodSide =
    cat === "food_and_beverages" ||
    cat === "baby_product_food" ||
    cat === "unknown";
  const careSide = cat === "personal_care" || cat === "baby_product_care";
  const household = cat === "household_cleaning";
  const baby = cat === "baby_product_food" || cat === "baby_product_care";

  // Every category (baby ones included) now has its own rule block; only the
  // 'unknown' bucket has to borrow one.
  const rulesKey = cat === "unknown" ? "food_and_beverages" : cat;
  const rule =
    PRODUCT_CATEGORY_RULES[rulesKey] ?? PRODUCT_CATEGORY_RULES.food_and_beverages;

  const out: CompactReference = {
    category: cat,
    regulatory: {
      regulatory_body: rule.regulatory_body,
      act: rule.act,
      complaint_portal: rule.complaint_portal,
      required_labels: rule.required_labels,
      additional_checks: rule.additional_checks,
    },
    banned_ingredients: [],
    harmful_additives: [],
  };

  if (foodSide) {
    out.banned_ingredients = BANNED_INGREDIENTS.map((b) => ({
      name: b.name,
      also_known_as: b.also_known_as,
      e_code: b.e_code,
      severity: b.severity,
    }));
    out.harmful_additives = HARMFUL_ADDITIVES.map((a) => ({
      name: a.name,
      e_code: a.e_code,
      ins_code: a.ins_code,
      concern_level: a.concern_level,
      fssai_max_limit_mg_per_kg: a.max_limit_in_india_mg_per_kg,
    }));
    out.fssai_limits = FSSAI_ADDITIVE_LIMITS.map((l) => ({
      name: l.name,
      also_known_as: l.also_known_as,
      e_code: l.e_code,
      ins_code: l.ins_code,
      category: l.category,
      fssai_max_limit_mg_per_kg: l.fssai_max_limit_mg_per_kg,
      special_limits: l.special_limits,
      adi_mg_per_kg_body_weight: l.adi_mg_per_kg_body_weight ?? null,
    }));
    out.legal_metrology = Object.entries(
      LEGAL_METROLOGY_RULES.MANDATORY_DECLARATIONS,
    ).map(([declaration, d]) => ({
      declaration,
      requirement: d.requirement,
    }));
  }

  if (careSide) {
    out.banned_ingredients = PERSONAL_CARE_BANNED_INGREDIENTS.map((b) => ({
      name: b.name,
      severity: b.severity,
    }));
    out.harmful_additives = PERSONAL_CARE_HARMFUL_ADDITIVES.map((a) => ({
      name: a.name,
      concern_level: a.concern_level,
    }));
    out.labelling_rules = rule.required_labels;
  }

  if (household) {
    out.household_safety = HOUSEHOLD_PRODUCT_SAFETY.map((h) => ({
      name: h.name,
      concern_level: h.concern_level,
      safety_note: h.safety_note,
    }));
    out.labelling_rules = rule.required_labels;
  }

  if (foodSide) {
    // Nutritional quality is a food-only dimension. Names + aliases + the
    // concern type/level/penalty are all the model needs to IDENTIFY a
    // concern; the prose is re-attached locally by lib/enrich-analysis.ts.
    out.nutritional_concerns = NUTRITIONAL_CONCERNS.map((n) => ({
      name: n.name,
      also_known_as: n.also_known_as,
      concern_type: n.concern_type,
      concern_level: n.concern_level,
      score_penalty: n.score_penalty,
    }));
    out.nutritional_thresholds = NUTRITIONAL_THRESHOLDS;
  }

  if (baby) {
    out.stricter_thresholds_note =
      "BABY PRODUCT — zero tolerance. Flag ANY artificial colour, artificial sweetener or harmful preservative as at least 'harmful' (or 'banned' if it is on a banned list). Flag ANY ingredient with even a 'low' concern level as 'caution'. Apply the stricter of the Indian and EU limits from your own knowledge.";
  }

  return out;
}

// ===========================================================================
// NUTRITIONAL QUALITY — the second dimension
// ===========================================================================
//
// Everything above this line is about SAFETY: banned substances, harmful
// additives, FSSAI limits. A product can pass all of it and still be a poor
// food — refined flour, three kinds of sugar and palm oil are all perfectly
// legal and additive-free, and would score 96/100 on safety alone.
//
// NUTRITIONAL_CONCERNS and NUTRITIONAL_THRESHOLDS drive a separate
// nutrition_score (25-100). The scoring itself lives in lib/enrich-analysis.ts
// so that the model IDENTIFIES ingredients and our code does the ARITHMETIC.
//
// Tone rule for every string below: factual, never alarmist. A refined-grain
// product is not dangerous, it is a less nutritious choice — say that plainly
// and name something better.

export interface NutritionalConcernEntry {
  name: string;
  /** Label spellings a manufacturer might use. Matched case-insensitively. */
  also_known_as: string[];
  concern_type: NutritionalConcernType;
  concern_level: NutritionalConcernLevel;
  /**
   * Points off nutrition_score, applied under the double-counting rules in
   * lib/enrich-analysis.ts — a threshold penalty and an ingredient penalty
   * must never both charge for the same problem.
   */
  score_penalty: number;
  why_flagged: string;
  health_effects: string;
  moderation_guidance: string;
  who_should_limit: string[];
  better_alternative: string;
}

export const NUTRITIONAL_CONCERNS: NutritionalConcernEntry[] = [
  // -------------------------------------------------------------------------
  // REFINED GRAINS — deliberately ranked. These are NOT equivalent: maida is
  // stripped bare; semolina is coarser and keeps more of the grain.
  // -------------------------------------------------------------------------
  {
    name: "Maida",
    also_known_as: [
      "Refined Wheat Flour",
      "Refined Flour",
      "All Purpose Flour",
      "All-Purpose Flour",
      "Wheat Flour (Refined)",
      "White Flour",
      "Plain Flour",
    ],
    concern_type: "refined_grain",
    concern_level: "significant",
    score_penalty: 18,
    why_flagged:
      "Maida is wheat stripped of its bran and germ, removing nearly all fibre, B vitamins, iron and healthy fats. What remains is mostly starch.",
    health_effects:
      "Digests very quickly and spikes blood sugar (high glycemic index). Regular consumption is linked to insulin resistance, weight gain around the abdomen, and higher risk of type 2 diabetes. The near-total absence of fibre means it does not keep you full, leading to overeating, and it slows digestion causing constipation.",
    moderation_guidance:
      "Fine occasionally. As a daily staple it displaces more nutritious grains — aim for no more than a few servings a week.",
    who_should_limit: [
      "Diabetic",
      "Pre-diabetic",
      "Weight management",
      "Heart condition",
    ],
    better_alternative:
      "Whole wheat atta, multigrain flour, millet flours (ragi, bajra, jowar)",
  },
  {
    name: "Durum Wheat Semolina",
    also_known_as: [
      "Semolina",
      "Sooji",
      "Suji",
      "Rava",
      "Durum Wheat",
      "Durum Semolina",
      "Durum Wheat Semolina (Sooji)",
    ],
    concern_type: "refined_grain",
    concern_level: "moderate",
    score_penalty: 12,
    why_flagged:
      "Semolina is a refined grain, but a coarser and less processed one than maida. It retains more protein and has a lower glycemic index, though the bran and germ are still largely removed.",
    health_effects:
      "Raises blood sugar more slowly than maida but still faster than whole grains. Fibre content is low, so it is less filling than whole wheat. Contains gluten.",
    moderation_guidance:
      "Reasonable in moderation and better than maida-based products, but whole grain versions remain the healthier everyday choice.",
    who_should_limit: ["Diabetic", "Gluten", "Wheat"],
    better_alternative: "Whole wheat pasta, millet pasta, buckwheat noodles",
  },
  {
    name: "White Rice",
    also_known_as: [
      "Polished Rice",
      "Refined Rice",
      "Milled Rice",
      "Rice (Polished)",
      "Rice Flour",
      "Refined Rice Flour",
      "White Rice Flour",
    ],
    concern_type: "refined_grain",
    concern_level: "moderate",
    score_penalty: 12,
    why_flagged:
      "Polishing removes the bran and germ from the rice grain, taking most of the fibre, magnesium and B vitamins with them and leaving mainly starch.",
    health_effects:
      "Has a high glycemic index, so it raises blood sugar quickly and is less filling than unpolished rice. Large regular portions are associated with higher risk of type 2 diabetes in South Asian populations specifically.",
    moderation_guidance:
      "A normal part of an Indian diet — the issue is portion size and eating it with nothing alongside. Pair it with dal, vegetables or curd, or swap some meals for an unpolished grain.",
    who_should_limit: ["Diabetic", "Pre-diabetic", "Weight management"],
    better_alternative: "Brown rice, hand-pounded rice, millets, quinoa",
  },
  {
    name: "Corn Starch",
    also_known_as: [
      "Cornstarch",
      "Corn Flour",
      "Maize Starch",
      "Modified Starch",
      "Modified Corn Starch",
      "Modified Food Starch",
      "Tapioca Starch",
      "Potato Starch",
    ],
    concern_type: "refined_grain",
    concern_level: "moderate",
    score_penalty: 10,
    why_flagged:
      "Pure starch extracted from the grain with the protein, fibre and micronutrients removed. It is used for texture and bulk and contributes calories with essentially no nutrition of its own.",
    health_effects:
      "Digests rapidly and raises blood sugar. In small amounts as a thickener this is unimportant; high in the ingredients order it means a large share of the product is refined starch.",
    moderation_guidance:
      "Not a concern as a minor thickener. Worth noting when it appears in the first few ingredients, which means the product is mostly starch.",
    who_should_limit: ["Diabetic", "Pre-diabetic"],
    better_alternative:
      "Products thickened with whole grain flour, oats, or nothing at all",
  },
  {
    name: "White Bread",
    also_known_as: [
      "Refined Flour Bread",
      "Maida Bread",
      "White Pav",
      "Milk Bread",
      "Sandwich Bread (White)",
    ],
    concern_type: "refined_grain",
    concern_level: "significant",
    score_penalty: 16,
    why_flagged:
      "White bread is made almost entirely from refined flour, usually with added sugar and salt, and has had the fibre-bearing parts of the wheat removed before baking.",
    health_effects:
      "Digests quickly and raises blood sugar sharply for a food eaten in large daily quantities. Low fibre means poor satiety, and it commonly carries more sodium than people expect.",
    moderation_guidance:
      "Fine occasionally. If bread is a daily food, a whole-grain loaf is a meaningfully better everyday choice.",
    who_should_limit: [
      "Diabetic",
      "Pre-diabetic",
      "Weight management",
      "Hypertension (high BP)",
    ],
    better_alternative:
      "100% whole wheat bread, multigrain bread with visible grains, whole wheat sourdough",
  },

  // -------------------------------------------------------------------------
  // ADDED SUGARS — every alias, because manufacturers split sugar across
  // several names so no single one appears high in the ingredients order.
  // -------------------------------------------------------------------------
  {
    name: "Sugar",
    also_known_as: [
      "Sucrose",
      "Cane Sugar",
      "Refined Sugar",
      "White Sugar",
      "Brown Sugar",
      "Caster Sugar",
      "Demerara Sugar",
      "Icing Sugar",
      "Added Sugar",
    ],
    concern_type: "added_sugar",
    concern_level: "significant",
    // Charged only when no nutrition panel was visible. When the per-100 sugar
    // threshold fires at 'high' this penalty is suppressed (STEP 3 rule).
    score_penalty: 12,
    why_flagged:
      "Sugar added during manufacture contributes calories with no vitamins, minerals or fibre. The WHO recommends keeping free sugars under 10% of daily energy, and ideally under 5%.",
    health_effects:
      "Raises blood glucose quickly, promotes weight gain when it displaces more filling foods, and is the single largest dietary contributor to tooth decay. Sustained high intake is associated with fatty liver, raised triglycerides and higher type 2 diabetes risk.",
    moderation_guidance:
      "Sugar is not poison and an occasional sweet food is fine. The problem is cumulative daily intake from products that do not taste sweet — sauces, breads, breakfast cereals, biscuits.",
    who_should_limit: [
      "Diabetic",
      "Pre-diabetic",
      "Weight management",
      "Child under 12",
    ],
    better_alternative:
      "Unsweetened versions, whole fruit for sweetness, products listing under 5 g sugar per 100 g",
  },
  {
    name: "High Fructose Corn Syrup",
    also_known_as: [
      "HFCS",
      "Corn Syrup",
      "Glucose-Fructose Syrup",
      "Fructose-Glucose Syrup",
      "High Maltose Corn Syrup",
      "Isoglucose",
    ],
    concern_type: "added_sugar",
    concern_level: "significant",
    score_penalty: 15,
    why_flagged:
      "A cheap liquid sweetener with a high free-fructose content, used in place of sugar because it costs less and mixes easily into drinks and sauces.",
    health_effects:
      "Free fructose is processed almost entirely by the liver. High regular intake is associated with non-alcoholic fatty liver disease, raised blood triglycerides, insulin resistance and abdominal weight gain. Because it is liquid it does not trigger fullness the way solid food does, so the calories add on top of what you already ate.",
    moderation_guidance:
      "Worth avoiding as a routine ingredient. Its presence usually signals a heavily sweetened processed product.",
    who_should_limit: [
      "Diabetic",
      "Pre-diabetic",
      "Weight management",
      "Heart condition",
      "Child under 12",
    ],
    better_alternative:
      "Products sweetened with whole fruit or nothing at all; plain water or unsweetened drinks",
  },
  {
    name: "Invert Sugar",
    also_known_as: [
      "Invert Syrup",
      "Liquid Glucose",
      "Glucose Syrup",
      "Dextrose",
      "Dextrose Monohydrate",
      "Maltodextrin",
      "Maltose",
      "Golden Syrup",
    ],
    concern_type: "added_sugar",
    concern_level: "moderate",
    score_penalty: 8,
    why_flagged:
      "These are all manufactured sugars used for sweetness, bulk and texture. Maltodextrin in particular is not sweet, so it is easy to miss, but it raises blood glucose faster than table sugar does.",
    health_effects:
      "Digest and absorb rapidly, producing a quick blood-sugar rise with no fibre, protein or micronutrients alongside. They add to the product's total sugar load even when 'sugar' itself appears far down the list.",
    moderation_guidance:
      "Individually minor. Their real significance is as a signal — when two or three appear together, the product carries far more added sugar than its ingredients order suggests.",
    who_should_limit: ["Diabetic", "Pre-diabetic", "Weight management"],
    better_alternative:
      "Products with a short ingredients list and a single named sweetener, or none",
  },
  {
    name: "Fructose",
    also_known_as: ["Crystalline Fructose", "Added Fructose"],
    concern_type: "added_sugar",
    concern_level: "moderate",
    score_penalty: 8,
    why_flagged:
      "Added fructose is not the same as the fructose in whole fruit, which arrives with fibre, water and micronutrients that slow its absorption.",
    health_effects:
      "Metabolised chiefly in the liver. Regular high intake in isolated form is linked to raised triglycerides and fat accumulation in the liver. It does not raise blood glucose as sharply as glucose, which is why it is marketed as diabetic-friendly — that does not make it a health food.",
    moderation_guidance:
      "Treat it as sugar by another name. Whole fruit is a completely different proposition and needs no limiting.",
    who_should_limit: ["Weight management", "Heart condition", "Diabetic"],
    better_alternative: "Whole fruit, unsweetened products",
  },
  {
    name: "Glucose Syrup Solids",
    also_known_as: [
      "Dried Glucose Syrup",
      "Corn Syrup Solids",
      "Glucose Solids",
    ],
    concern_type: "added_sugar",
    concern_level: "moderate",
    score_penalty: 8,
    why_flagged:
      "Dehydrated glucose syrup used as a bulking sweetener in powders, drink mixes and confectionery. It is sugar in a form that pours like flour.",
    health_effects:
      "Absorbs quickly and raises blood glucose. Adds calories and sweetness with no accompanying nutrition.",
    moderation_guidance:
      "Occasional intake is unimportant; watch for it in products consumed daily, such as beverage powders and health drinks.",
    who_should_limit: ["Diabetic", "Pre-diabetic", "Weight management"],
    better_alternative: "Unsweetened powders, plain milk, plain water",
  },
  {
    name: "Honey",
    also_known_as: ["Honey Powder", "Honey Solids"],
    concern_type: "added_sugar",
    concern_level: "mild",
    score_penalty: 4,
    why_flagged:
      "Honey added to a processed food counts as an added sugar. It carries traces of antioxidants and enzymes, but nutritionally it behaves much like table sugar.",
    health_effects:
      "Raises blood glucose similarly to sugar. The trace nutrients are present in quantities too small to offset the sugar load at the amounts used in manufacturing.",
    moderation_guidance:
      "A genuinely small advantage over refined sugar, and no reason on its own to avoid a product — but it still counts towards your daily free-sugar intake.",
    who_should_limit: ["Diabetic", "Pre-diabetic", "Child under 5"],
    better_alternative: "Unsweetened products, whole fruit",
  },
  {
    name: "Jaggery",
    also_known_as: ["Gur", "Jaggery Powder", "Palm Jaggery", "Cane Jaggery"],
    concern_type: "added_sugar",
    concern_level: "mild",
    score_penalty: 4,
    why_flagged:
      "Jaggery is less refined than white sugar and retains small amounts of iron and minerals, but as an added sweetener it is still concentrated sugar.",
    health_effects:
      "Raises blood glucose much like sugar does. The mineral content is real but modest — you would have to eat an unhealthy quantity for it to matter nutritionally.",
    moderation_guidance:
      "A reasonable traditional choice over refined sugar. It is not a free pass; the amount still counts.",
    who_should_limit: ["Diabetic", "Pre-diabetic"],
    better_alternative:
      "Unsweetened products, or the same product with less of it",
  },
  {
    name: "Molasses",
    also_known_as: ["Treacle", "Blackstrap Molasses", "Cane Molasses"],
    concern_type: "added_sugar",
    concern_level: "mild",
    score_penalty: 4,
    why_flagged:
      "A by-product of sugar refining used for colour and a deep sweetness. It keeps some iron, calcium and potassium, but remains an added sugar.",
    health_effects:
      "Contributes to total free-sugar intake and raises blood glucose. Its mineral content is the highest of any sugar syrup, though still small in the amounts actually used.",
    moderation_guidance:
      "Nutritionally the least objectionable of the sugar syrups — count it as sugar all the same.",
    who_should_limit: ["Diabetic", "Pre-diabetic"],
    better_alternative: "Unsweetened products",
  },
  {
    name: "Malt Extract",
    also_known_as: [
      "Barley Malt Extract",
      "Malt Syrup",
      "Malted Barley Extract",
      "Liquid Malt",
    ],
    concern_type: "added_sugar",
    concern_level: "moderate",
    score_penalty: 6,
    why_flagged:
      "Malt extract is largely maltose — a sugar — used for sweetness, colour and flavour. It reads like a grain ingredient but functions as a sweetener.",
    health_effects:
      "Raises blood glucose quickly; maltose has a glycemic index higher than table sugar. It contributes meaningfully to the sugar total in breakfast cereals and malted drinks.",
    moderation_guidance:
      "Worth recognising as sugar when judging a product marketed on its grain or malt content.",
    who_should_limit: [
      "Diabetic",
      "Pre-diabetic",
      "Gluten",
      "Weight management",
    ],
    better_alternative: "Unsweetened cereals and drinks, plain milk",
  },
  {
    name: "Rice Syrup",
    also_known_as: ["Brown Rice Syrup", "Rice Malt Syrup"],
    concern_type: "added_sugar",
    concern_level: "moderate",
    score_penalty: 8,
    why_flagged:
      "Marketed as a natural sweetener, but it is almost entirely glucose and has one of the highest glycemic indices of any sweetener in common use.",
    health_effects:
      "Raises blood glucose faster than table sugar. Carries no meaningful fibre, vitamins or minerals despite the wholefood positioning.",
    moderation_guidance:
      "Treat it exactly as you would sugar; the 'brown rice' name does not change what it does.",
    who_should_limit: ["Diabetic", "Pre-diabetic", "Weight management"],
    better_alternative: "Unsweetened products, whole fruit",
  },
  {
    name: "Agave Syrup",
    also_known_as: ["Agave Nectar", "Agave Sweetener"],
    concern_type: "added_sugar",
    concern_level: "moderate",
    score_penalty: 8,
    why_flagged:
      "Agave syrup is roughly 80% fructose — a higher share than high fructose corn syrup — despite being sold as a healthy alternative to sugar.",
    health_effects:
      "The low glycemic index it is marketed on comes from that fructose load, which is handled by the liver rather than raising blood glucose. Regular high intake is linked to raised triglycerides and liver fat.",
    moderation_guidance:
      "No advantage over sugar for most people, and a disadvantage for anyone watching their liver or triglycerides.",
    who_should_limit: ["Weight management", "Heart condition", "Diabetic"],
    better_alternative: "Whole fruit, unsweetened products",
  },
  {
    name: "Fruit Juice Concentrate",
    also_known_as: [
      "Concentrated Fruit Juice",
      "Apple Juice Concentrate",
      "Grape Juice Concentrate",
      "Pear Juice Concentrate",
      "Deionised Fruit Juice",
    ],
    concern_type: "added_sugar",
    concern_level: "moderate",
    score_penalty: 7,
    why_flagged:
      "Fruit juice with the water — and usually the fibre and much of the flavour — removed, leaving concentrated sugar that can be declared as fruit rather than as sugar.",
    health_effects:
      "Nutritionally close to added sugar. Without the fibre of whole fruit it is absorbed quickly and does little to fill you up, so it adds sugar to the product while making the label read as fruit-based.",
    moderation_guidance:
      "A common way to sweeten a product while marketing it as having 'no added sugar'. Judge it by the total sugar figure on the panel, not by the ingredient name.",
    who_should_limit: ["Diabetic", "Pre-diabetic", "Child under 12"],
    better_alternative: "Whole fruit, unsweetened products",
  },

  // -------------------------------------------------------------------------
  // REFINED AND PROCESSED OILS
  // -------------------------------------------------------------------------
  {
    name: "Palm Oil",
    also_known_as: [
      "Palmolein",
      "Palmolein Oil",
      "Refined Palmolein",
      "Palm Kernel Oil",
      "Palm Fat",
      "Vegetable Fat (Palm)",
    ],
    concern_type: "refined_oil",
    concern_level: "moderate",
    score_penalty: 8,
    why_flagged:
      "Palm oil is about half saturated fat, which is unusually high for a plant oil. It is used because it is cheap, stable at high temperatures and solid at room temperature.",
    health_effects:
      "Raises LDL, the cholesterol fraction associated with arterial plaque. Regularly replacing unsaturated cooking oils with palm oil is associated with a less favourable blood lipid profile and higher cardiovascular risk.",
    moderation_guidance:
      "Common in Indian packaged snacks and bakery products, so it accumulates quickly across a day. Worth limiting rather than eliminating.",
    who_should_limit: [
      "Heart condition",
      "Hypertension (high BP)",
      "Weight management",
      "No palm oil",
    ],
    better_alternative:
      "Groundnut oil, mustard oil, rice bran oil, sunflower oil, cold-pressed oils",
  },
  {
    name: "Refined Vegetable Oil",
    also_known_as: [
      "Vegetable Oil",
      "Edible Vegetable Oil",
      "Refined Oil",
      "Vegetable Fat",
      "Refined Edible Oil",
    ],
    concern_type: "refined_oil",
    concern_level: "moderate",
    score_penalty: 6,
    why_flagged:
      "The source is not disclosed, so you cannot tell whether it is a reasonable oil or palm oil. It has also been bleached and deodorised, which strips the vitamin E and plant compounds a cold-pressed oil retains.",
    health_effects:
      "The effect depends entirely on the undisclosed source. Refining itself removes most of the antioxidants and, at industrial temperatures, generates small amounts of oxidised fats.",
    moderation_guidance:
      "The lack of disclosure is itself the issue — a manufacturer using a good oil usually names it. Prefer products that say which oil they used.",
    who_should_limit: ["Heart condition", "No palm oil"],
    better_alternative:
      "Products naming a single oil — cold-pressed groundnut, mustard, sesame or rice bran",
  },
  {
    name: "Hydrogenated Vegetable Oil",
    also_known_as: [
      "Partially Hydrogenated Oil",
      "Partially Hydrogenated Vegetable Oil",
      "Hydrogenated Fat",
      "Vanaspati",
      "Bakery Shortening",
      "Hydrogenated Margarine",
    ],
    concern_type: "trans_fat",
    concern_level: "significant",
    score_penalty: 15,
    why_flagged:
      "Partial hydrogenation creates industrial trans fat. There is no safe level of it — the WHO has called for its complete elimination from the food supply, and FSSAI caps it at 2% of total fat.",
    health_effects:
      "Raises LDL cholesterol and simultaneously lowers HDL, a combination no other dietary fat produces. Strongly linked to coronary heart disease, and associated with systemic inflammation and insulin resistance.",
    moderation_guidance:
      "This is the one nutritional ingredient genuinely worth avoiding outright rather than moderating.",
    who_should_limit: [
      "Heart condition",
      "Hypertension (high BP)",
      "Diabetic",
      "No trans fat",
      "Pregnant",
      "Child under 12",
    ],
    better_alternative:
      "Products using non-hydrogenated oils, ghee in moderation, cold-pressed oils",
  },
  {
    name: "Interesterified Fat",
    also_known_as: [
      "Interesterified Vegetable Fat",
      "Interesterified Oil",
      "Rearranged Fat",
    ],
    concern_type: "refined_oil",
    concern_level: "moderate",
    score_penalty: 8,
    why_flagged:
      "The industry's replacement for partially hydrogenated fat. It contains no trans fat, which is a real improvement, but achieves solidity by rearranging saturated fatty acids instead.",
    health_effects:
      "Clearly better than trans fat. The long-term evidence is thinner than for other fats, and some studies suggest effects on blood glucose and HDL, so it is not a neutral ingredient.",
    moderation_guidance:
      "An improvement on what it replaced. Still an industrially modified fat, used in products that tend to be high in fat overall.",
    who_should_limit: ["Heart condition", "Diabetic"],
    better_alternative:
      "Products made with named unmodified oils, or with less fat overall",
  },

  // -------------------------------------------------------------------------
  // PROCESSED PROTEIN
  // -------------------------------------------------------------------------
  {
    name: "Processed Meat",
    also_known_as: [
      "Salami",
      "Sausage",
      "Ham",
      "Bacon",
      "Cured Meat",
      "Pepperoni",
      "Luncheon Meat",
      "Smoked Meat",
      "Corned Beef",
      "Hot Dog",
      "Frankfurter",
      "Chicken Salami",
      "Chicken Sausage",
    ],
    concern_type: "processed_protein",
    concern_level: "significant",
    score_penalty: 15,
    why_flagged:
      "Meat preserved by smoking, curing, salting or nitrite preservatives. The WHO's cancer agency (IARC) classifies processed meat as a Group 1 carcinogen — the category where the evidence for a causal link in humans is strongest.",
    health_effects:
      "Regular consumption is causally associated with colorectal cancer; the IARC estimate is roughly an 18% increase in relative risk per 50 g eaten daily. Processed meat is also high in sodium and saturated fat, which independently affect blood pressure and blood lipids.",
    moderation_guidance:
      "Group 1 describes the strength of the evidence, not the size of the risk — an occasional serving is not comparable to smoking. The guidance is to make it occasional rather than routine.",
    who_should_limit: [
      "Hypertension (high BP)",
      "Heart condition",
      "Kidney condition",
      "Pregnant",
      "Child under 12",
    ],
    better_alternative:
      "Fresh unprocessed chicken, fish, eggs, paneer, or legumes",
  },
];

// ---------------------------------------------------------------------------
// NUTRITIONAL_THRESHOLDS — per 100 g (solids) / per 100 ml (beverages)
// ---------------------------------------------------------------------------
//
// Bands follow FSSAI front-of-pack guidance and the WHO / UK FSA traffic-light
// model, deliberately steepened (2026 recalibration): a product that is extreme
// in ONE nutrient must not escape almost unpenalised just because ingredient
// penalties are the only thing that stacks. Each threshold is a list of bands
// ordered HIGH to LOW — the first band whose `above` the value exceeds wins;
// a value below every band is 'low' with no penalty.

export interface NutrientBand {
  /** A value STRICTLY greater than this sits in this band (bands run high→low). */
  above: number;
  level: NutrientLevel;
  /** Points subtracted from nutrition_score when this band is the one that fires. */
  penalty: number;
}

export interface NutrientThreshold {
  /** Display name used in the UI and the PDF. */
  nutrient: string;
  unit: "g" | "mg";
  /** Bands ordered from the most severe (`very_high`) down. */
  bands: NutrientBand[];
  /** Plain-language band, shown beside the value. */
  reference: string;
}

export interface NutrientBonus {
  nutrient: string;
  unit: "g";
  high_above: number;
  high_bonus: number;
  medium_from: number;
  medium_bonus: number;
  reference: string;
}

export const NUTRITIONAL_THRESHOLDS = {
  /** Sugar in a SOLID food, per 100 g. */
  sugar_solid: {
    nutrient: "Sugar",
    unit: "g",
    bands: [
      { above: 40, level: "very_high", penalty: 45 },
      { above: 22.5, level: "high", penalty: 30 },
      { above: 5, level: "medium", penalty: 12 },
    ],
    reference: "Very high above 40 g, high above 22.5 g, low below 5 g per 100 g",
  } as NutrientThreshold,

  /** Sugar in a BEVERAGE, per 100 ml. A different scale, not a rescaled one. */
  sugar_liquid: {
    nutrient: "Sugar",
    unit: "g",
    bands: [
      { above: 20, level: "very_high", penalty: 45 },
      { above: 11.25, level: "high", penalty: 35 },
      { above: 5, level: "medium_high", penalty: 25 },
      { above: 2.5, level: "medium", penalty: 12 },
    ],
    reference:
      "Very high above 20 g, high above 11.25 g, low below 2.5 g per 100 ml",
  } as NutrientThreshold,

  /** Sodium per 100 g. 600 mg sodium is 1.5 g salt (salt = sodium x 2.5). */
  sodium: {
    nutrient: "Sodium",
    unit: "mg",
    bands: [
      { above: 1200, level: "very_high", penalty: 35 },
      { above: 600, level: "high", penalty: 25 },
      { above: 120, level: "medium", penalty: 10 },
    ],
    reference:
      "Very high above 1200 mg, high above 600 mg sodium (1.5 g salt) per 100 g",
  } as NutrientThreshold,

  saturated_fat: {
    nutrient: "Saturated fat",
    unit: "g",
    bands: [
      { above: 10, level: "very_high", penalty: 30 },
      { above: 5, level: "high", penalty: 20 },
      { above: 1.5, level: "medium", penalty: 8 },
    ],
    reference: "Very high above 10 g, high above 5 g per 100 g",
  } as NutrientThreshold,

  total_fat: {
    nutrient: "Total fat",
    unit: "g",
    bands: [
      { above: 30, level: "very_high", penalty: 20 },
      { above: 17.5, level: "high", penalty: 14 },
      { above: 3, level: "medium", penalty: 6 },
    ],
    reference: "Very high above 30 g, high above 17.5 g per 100 g",
  } as NutrientThreshold,

  /**
   * Trans fat has a single band — anything above 0.2 g per 100 g is a severe
   * flag. FSSAI additionally caps it at 2% of total fat; exceeding that is a
   * COMPLIANCE violation as well as a nutritional one.
   */
  trans_fat: {
    nutrient: "Trans fat",
    unit: "g",
    bands: [{ above: 0.2, level: "very_high", penalty: 40 }],
    reference: "Any amount above 0.2 g per 100 g",
  } as NutrientThreshold,

  /** FSSAI cap on trans fat as a share of total fat. */
  trans_fat_share_of_total_fat: 0.02,

  /** The one POSITIVE nutrient — a bonus, not a penalty. */
  fibre: {
    nutrient: "Fibre",
    unit: "g",
    high_above: 6,
    high_bonus: 5,
    medium_from: 3,
    medium_bonus: 2,
    reference: "Good above 6 g per 100 g",
  } as NutrientBonus,

  /** More than 10 ingredients AND at least 3 additives (E-numbers / INS codes). */
  ultra_processing: {
    min_ingredients_exclusive: 10,
    min_additives: 3,
    penalty: 10,
    message:
      "This is an ultra-processed food. Diets high in ultra-processed foods are associated with obesity, cardiovascular disease and type 2 diabetes regardless of individual ingredient safety.",
  },

  /**
   * Three or more DISTINCT added-sugar names in one ingredients list. Applies
   * whether or not the sugar threshold fired.
   */
  sugar_alias_rule: {
    min_distinct_aliases: 3,
    penalty: 8,
    message:
      "This product lists sugar under multiple names, which makes the total sugar content appear lower in the ingredients order than it actually is.",
  },

  /**
   * 2026 recalibration — hard ceilings on nutrition_score, applied AFTER the
   * penalty arithmetic. The LOWEST applicable cap wins. A product that is
   * extreme in one dimension cannot score well by simply having few other
   * faults, however generous the arithmetic was.
   */
  score_caps: {
    /** Any nutrient in its 'very_high' band. */
    any_very_high: 30,
    /** Any nutrient in its 'high' band. */
    any_high: 45,
    /** Two or more nutrients at 'medium' or worse. */
    two_plus_medium: 60,
    /** Trans fat above 0.2 g per 100 g anywhere on the panel. */
    trans_fat_present: 20,
    /** A beverage whose sugar is 'medium_high' or worse — a sugar-sweetened drink. */
    beverage_sugar_medium_high: 30,
    /** 3+ distinct sugar names AND no nutrition panel to check the total against. */
    sugar_aliases_no_panel: 50,
  },

  /**
   * NUTRIENT-DENSITY ceilings. A finished product is scored for what it
   * positively provides, not merely the absence of faults. Applies ONLY to
   * food_type 'processed_product' and 'minimally_processed' — never to staple
   * ingredients, which are cooking inputs, not complete foods. For
   * 'minimally_processed' each ceiling is raised by `density_cap_minimally_bonus`.
   *   empty    -> 35   soft drinks, boiled sweets, pure refined-flour snacks
   *   low      -> 75   refined grains / starches / oils / sugars as the base
   *   moderate -> 88   some value, but noticeably refined or narrow
   *   high     -> none  whole grains, legumes, dairy, eggs, produce
   */
  density_caps: {
    empty: 35,
    low: 75,
    moderate: 88,
    high: null,
  },
  density_cap_minimally_bonus: 10,
  /**
   * The 90+ band is reserved. Only nutrient_density 'high' with no concern at
   * 'moderate' or above may exceed this; everything else caps here. Applies to
   * 'processed_product' only.
   */
  top_band_reserve: 85,
  /** No packaged, processed food is nutritionally perfect. */
  max_nutrition_score: 95,

  /**
   * STAPLE INGREDIENT scale (2026 food-type restructure). Staples are scored
   * far more gently: no density cap, no ultra-processing penalty, ingredient
   * concern penalties halved. A graded refinement deduction (derived from
   * nutrient_density, since density is still computed for staples even though
   * it is not a ceiling) is what separates whole-grain staples from refined
   * ones. Protein / whole-grain bonuses are suppressed when the primary
   * ingredient is itself a refined grain.
   */
  staple_refinement_penalty: { high: 0, moderate: 6, low: 22, empty: 22 },
  /** A plain cooking ingredient is a building block, never a "bad product". */
  staple_floor: 60,
  /** Total staple penalty is capped here before the floor is applied. */
  staple_penalty_cap: 70,
  /**
   * EXCEPTION: pure sugar, pure refined oil and salt sold as standalone
   * staples are calorically empty or extreme — they get this flat score and
   * the "use sparingly" note, not the 60 floor.
   */
  staple_extreme_score: 40,

  /**
   * nutrition_score = 100 - min(penalties, max_total_penalty) + bonuses.
   * `score_floor_soft` holds first — a product whose only issue is moderate
   * never drops below it from arithmetic alone. The score_caps above may then
   * push under it, and only `score_floor` (the hard floor) is applied last.
   */
  max_total_penalty: 75,
  score_floor_soft: 25,
  score_floor: 10,

  /**
   * baby_product_food: halve every sugar, sodium and saturated-fat threshold,
   * and treat ANY added sugar as 'significant' regardless of amount.
   */
  baby_threshold_multiplier: 0.5,
} as const;

// ---------------------------------------------------------------------------
// NUTRITIONAL_POSITIVES — what a food actively contributes
// ---------------------------------------------------------------------------
//
// The scoring model used to only ever SUBTRACT: a food stayed high only by
// having no faults. This block lets genuine nutrition lift a score. Bonuses
// are summed, capped at `max_total`, and applied AFTER penalties and BEFORE
// the density / score caps, so they can lift a decent food but never mask a
// real problem. The three "absence" bonuses (no_added_sugar, no_added_salt,
// minimal_ingredients) are skipped for staple ingredients, where they are
// trivially true and would flatten the scale.

export const NUTRITIONAL_POSITIVES = {
  /** Fibre per 100 g, highest matching band wins. */
  fibre_g: [
    { above: 10, bonus: 12 },
    { above: 6, bonus: 8 },
    { above: 3, bonus: 4 },
  ],
  /** Protein per 100 g, highest matching band wins. */
  protein_g: [
    { above: 20, bonus: 10 },
    { above: 10, bonus: 6 },
    { above: 5, bonus: 3 },
  ],
  /** A whole grain is one of the first three ingredients. */
  whole_grain_primary: 12,
  /** A pulse / legume is one of the first three ingredients. */
  legume_primary: 12,
  /** Nuts or seeds are one of the first three ingredients. */
  nuts_seeds_primary: 8,
  /** Plain fermented dairy (curd / yoghurt) with no added sugar. */
  plain_fermented_dairy: 10,
  /** A micronutrient-dense ingredient present (leafy greens, millets, moringa). */
  micronutrient_dense: 6,
  /** No added sugar anywhere in the ingredients. */
  no_added_sugar: 5,
  /** No added salt / sodium beyond trace. */
  no_added_salt: 3,
  /** One or two ingredients and no additives. */
  minimal_ingredients: 5,
  max_total: 30,
} as const;


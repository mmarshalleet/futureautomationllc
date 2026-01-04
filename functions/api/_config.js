// functions/api/_config.js

/**
 * Single source of truth for PayPal + pricing.
 *
 * Why this file exists:
 * - Multiple Cloudflare Functions need the SAME pricing + environment logic.
 * - Keeping it here prevents drift ("worked before" bugs).
 */

export const CONFIG = {
  PRICING: {
    /** Upfront incident fee for standard support */
    standardFee: "495.00",

    /** Upfront incident fee for emergency / plant-down support */
    emergencyFee: "995.00",

    /** Currency used for PayPal orders */
    currency: "USD",
  },
};

/**
 * Backwards-compatible export used by some endpoints/pages.
 * We map `incidentFee` to `standardFee` so nothing crashes.
 */
export const PRICING = {
  ...CONFIG.PRICING,
  incidentFee: CONFIG.PRICING.standardFee,
};

/** Returns the current site origin (works on Pages custom domains + previews). */
export function siteOrigin(request) {
  return new URL(request.url).origin;
}

/** Returns the correct PayPal API base URL for live vs sandbox. */
export function paypalApiBase(env) {
  // Normalize "Live" / "LIVE" / "live" etc.
  const mode = (env.PAYPAL_ENV || "live").toString().toLowerCase();
  return mode === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

// NOTE: PRICING is exported once (above). A previous duplicate export here broke
// Cloudflare Functions bundling and caused /api/* to 404/500 at runtime.

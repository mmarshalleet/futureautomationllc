// functions/api/_config.js
// Single source of truth for pricing + return/cancel URLs.
// IMPORTANT: Some functions import CONFIG, others import PRICING.
// We export BOTH so the build can’t break from a refactor.

export const CONFIG = {
  standardFee: "495.00",
  emergencyFee: "795.00",
  currency: "USD",
  brandName: "Future Automation LLC",
  // Pages will deploy to prod domain; keep these page paths stable.
  returnPath: "/paid.html",
  cancelPath: "/request-support.html",
};

// Used by PayPal “create order” endpoints.
// "incidentFee" is what your PayPal order endpoints currently charge up-front.
export const PRICING = {
  incidentFee: CONFIG.standardFee,
  currency: CONFIG.currency,
};

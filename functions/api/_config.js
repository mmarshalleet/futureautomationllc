// functions/api/_config.js

export const PRICING = {
  standardFee: "495.00",
  emergencyFee: "795.00",
  hourly: "175.00",
  afterHours: "225.00",
  currency: "USD",
};

// Some files may import CONFIG, others PRICING.
// Export both so builds don't break.
export const CONFIG = { PRICING };

export function paypalApiBase(env) {
  const ppEnv = (env.PAYPAL_ENV || "live").toString().toLowerCase();
  return ppEnv.includes("sand")
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

export function siteOrigin(request) {
  return new URL(request.url).origin;
}
// functions/api/_config.js

export const CONFIG = {
  PRICING: {
    // change these numbers if you want
    standardFee: "495.00",
    emergencyFee: "995.00",
    currency: "USD",
  },
};

export function siteOrigin(request) {
  return new URL(request.url).origin;
}

export function paypalApiBase(env) {
  // Your dashboard shows PAYPAL_ENV = "Live" (capital L) — normalize it.
  const mode = (env.PAYPAL_ENV || "live").toString().toLowerCase();
  return mode === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}
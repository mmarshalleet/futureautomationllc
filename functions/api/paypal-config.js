// functions/api/paypal-config.js
// Public endpoint that exposes ONLY safe PayPal configuration to the browser.
//
// Why this exists:
// - The client (browser) needs a Client ID to load the PayPal JS SDK.
// - The Client Secret must NEVER leave the server (Cloudflare env var only).

import { PRICING } from "./_config.js";

export async function onRequestGet({ env }) {
  try {
    if (!env.PAYPAL_CLIENT_ID) {
      return new Response(JSON.stringify({ ok: false, error: "Missing PAYPAL_CLIENT_ID" }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const ppEnv = (env.PAYPAL_ENV || "live").toString().toLowerCase();

    return new Response(
      JSON.stringify({
        ok: true,
        clientId: env.PAYPAL_CLIENT_ID,
        env: ppEnv,
        currency: PRICING.currency,
        standardFee: PRICING.standardFee,
        emergencyFee: PRICING.emergencyFee,
        // Back-compat (older UI used this name)
        incidentFee: PRICING.incidentFee,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err?.message || String(err) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

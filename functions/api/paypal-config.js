// functions/api/paypal-config.js
// Public endpoint that exposes ONLY the PayPal client id (safe to publish) and a few UI constants.

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
        incidentFee: PRICING.incidentFee,
        currency: PRICING.currency,
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
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

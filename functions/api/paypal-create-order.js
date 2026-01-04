// functions/api/paypal-create-order.js
// Server-side order creation for PayPal Checkout (Smart Buttons).
//
// This endpoint:
// - uses PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET (server-side)
// - creates an order with the correct fee (standard vs emergency)
// - returns ONLY the PayPal order id to the browser

import { PRICING, paypalApiBase } from "./_config.js";

async function getAccessToken(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET");
  }

  const creds = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const r = await fetch(`${paypalApiBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${creds}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PayPal token error (${r.status}): ${JSON.stringify(j)}`);
  return j.access_token;
}

async function readJson(request) {
  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("application/json")) throw new Error("Expected application/json");
  return await request.json();
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJson(request);

    const ticketId = (body.ticketId || "").toString().trim();
    const plantDown = body.plantDown === true || body.plantDown === "true";

    if (!ticketId) {
      return new Response(JSON.stringify({ ok: false, error: "Missing ticketId" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // Basic sanity check to avoid garbage IDs.
    if (!/^FA-[A-Z0-9]+$/.test(ticketId)) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid ticketId format" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const accessToken = await getAccessToken(env);

    const description = plantDown
      ? "Emergency Plant-Down Support (Initial Incident)"
      : "Standard Remote Support (Initial Incident)";

    const value = plantDown ? PRICING.emergencyFee : PRICING.standardFee;

    const orderBody = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: ticketId,
          custom_id: ticketId,
          description,
          amount: {
            currency_code: PRICING.currency,
            value,
          },
        },
      ],
      application_context: {
        brand_name: "Future Automation LLC",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
      },
    };

    const r = await fetch(`${paypalApiBase(env)}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(orderBody),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return new Response(JSON.stringify({ ok: false, error: j }), {
        status: 502,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    return new Response(JSON.stringify({ ok: true, id: j.id }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err?.message || String(err) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

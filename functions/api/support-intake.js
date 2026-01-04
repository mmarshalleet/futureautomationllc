// functions/api/support-intake.js
import { CONFIG, paypalApiBase, siteOrigin } from "./_config.js";

async function readJson(request) {
  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error("Expected application/json");
  }
  return await request.json();
}

async function getPayPalAccessToken(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET");
  }

  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const base = paypalApiBase(env);

  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PayPal token error (${r.status}): ${JSON.stringify(j)}`);

  return j.access_token;
}

export async function onRequestPost({ request, env }) {
  try {
    const payload = await readJson(request);

    const pricingTier = (payload.pricingTier || "standard").toString().toLowerCase();
    const plantDown = payload.plantDown === true || payload.plantDown === "true";

    const isEmergency = pricingTier === "emergency" || plantDown;

    const amount = isEmergency
      ? CONFIG.PRICING.emergencyFee
      : CONFIG.PRICING.standardFee;

    const itemName = isEmergency
      ? "Emergency Plant-Down Support (Initial Incident)"
      : "Standard Remote Support (Initial Incident)";

    // Ticket id just for your UI text (you can later log it if you want)
    const ticketId = `FA-${Date.now().toString(36).toUpperCase()}`;

    const token = await getPayPalAccessToken(env);
    const base = paypalApiBase(env);
    const origin = siteOrigin(request);

    const returnUrl = `${origin}/support-success.html?ticket=${encodeURIComponent(ticketId)}`;
    const cancelUrl = `${origin}/request-support.html`;

    const orderRes = await fetch(`${base}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            description: itemName,
            custom_id: ticketId,
            amount: {
              currency_code: CONFIG.PRICING.currency,
              value: amount,
            },
          },
        ],
        application_context: {
          brand_name: "Future Automation LLC",
          user_action: "PAY_NOW",
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      }),
    });

    const order = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok) {
      throw new Error(`PayPal order error (${orderRes.status}): ${JSON.stringify(order)}`);
    }

    const approve = Array.isArray(order.links)
      ? order.links.find((l) => l.rel === "approve")?.href
      : null;

    if (!approve) throw new Error("PayPal approve link missing");

    return new Response(
      JSON.stringify({ ok: true, ticketId, paypalUrl: approve }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || String(err) }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
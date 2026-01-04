// functions/api/support-intake.js
// Creates a lightweight support ticket, then returns a PayPal approval URL.
//
// Expects application/json from request-support.html.
// Returns: { ok:true, ticketId, paypalUrl }

function paypalApiBase(env) {
  const ppEnv = (env.PAYPAL_ENV || "live").toString().toLowerCase();
  return ppEnv.includes("sand")
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

async function getAccessToken(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET");
  }

  const creds = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const r = await fetch(`${paypalApiBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "authorization": `Basic ${creds}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PayPal token error (${r.status}): ${JSON.stringify(j)}`);
  return j.access_token;
}

function newTicketId() {
  // FA-YYYYMMDDHHMM-R4NDO (5 chars)
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes());

  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let rand = "";
  for (let i = 0; i < 5; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return `FA-${stamp}-${rand}`;
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return jsonResponse({ ok: false, error: "Expected application/json" }, 400);
    }

    const body = await request.json();

    const pricingTier = (body.pricingTier || "").toString().toLowerCase();
    const requestType = (body.requestType || "").toString();
    const plantDown = !!body.plantDown || requestType.toLowerCase().includes("plant down");

    const tier = (pricingTier === "emergency" || plantDown) ? "emergency" : "standard";
    const amount = tier === "emergency" ? "795.00" : "495.00";
    const description = tier === "emergency"
      ? "Emergency Plant-Down Support (Initial Incident)"
      : "Remote Support (Initial Incident)";

    const ticketId = newTicketId();

    const accessToken = await getAccessToken(env);

    const orderBody = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: ticketId,
          custom_id: ticketId,
          description,
          amount: { currency_code: "USD", value: amount },
        },
      ],
      application_context: {
        brand_name: "Future Automation LLC",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
        return_url: `${new URL(request.url).origin}/paid.html?ticket=${encodeURIComponent(ticketId)}`,
        cancel_url: `${new URL(request.url).origin}/request-support.html`,
      },
    };

    const orderRes = await fetch(`${paypalApiBase(env)}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(orderBody),
    });

    const orderJson = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok) {
      return jsonResponse({ ok: false, error: `PayPal order error (${orderRes.status}): ${JSON.stringify(orderJson)}` }, 500);
    }

    const approve = (orderJson.links || []).find((l) => l.rel === "approve")?.href;
    if (!approve) {
      return jsonResponse({ ok: false, error: "PayPal approval link missing" }, 500);
    }

    return jsonResponse({ ok: true, ticketId, paypalUrl: approve, tier, amount });

  } catch (err) {
    return jsonResponse({ ok: false, error: err?.message || String(err) }, 500);
  }
}

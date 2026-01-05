import { CONFIG } from "./_config.js";

function paypalApiBase(env) {
  const ppEnv = (env.PAYPAL_ENV || "live").toString().toLowerCase();
  return ppEnv.includes("sand") ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

async function getAccessToken(env) {
  const secret = env.PAYPAL_CLIENT_SECRET || env.PAYPAL_SECRET;
  if (!env.PAYPAL_CLIENT_ID || !secret) {
    throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET/PAYPAL_SECRET");
  }
  const creds = btoa(`${env.PAYPAL_CLIENT_ID}:${secret}`);
  const r = await fetch(`${paypalApiBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${creds}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`PayPal token error (${r.status}): ${JSON.stringify(j)}`);
  return j.access_token;
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const ticketId = (body.ticketId || "").toString().trim();
    const plantDown = !!body.plantDown;

    if (!ticketId) return Response.json({ ok:false, error:"Missing ticketId" }, { status:400 });

    const accessToken = await getAccessToken(env);

    const amount = plantDown ? CONFIG.emergencyFee : CONFIG.standardFee;
    const description = plantDown ? "Emergency Plant-Down Support (Initial Incident)" : "Remote Support (Initial Incident)";

    const orderBody = {
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: ticketId,
        custom_id: ticketId,
        description,
        amount: { currency_code: CONFIG.currency, value: amount }
      }],
      application_context: {
        brand_name: CONFIG.brandName,
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
      },
    };

    const r = await fetch(`${paypalApiBase(env)}/v2/checkout/orders`, {
      method: "POST",
      headers: { "content-type":"application/json", authorization:`Bearer ${accessToken}` },
      body: JSON.stringify(orderBody),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) return Response.json({ ok:false, error:j }, { status:502 });

    return Response.json({ ok:true, id:j.id });
  } catch (err) {
    return Response.json({ ok:false, error: err?.message || String(err) }, { status:500 });
  }
}
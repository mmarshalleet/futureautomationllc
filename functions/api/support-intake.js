import { CONFIG } from "./_config.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function paypalBase(env) {
  const mode = (env.PAYPAL_ENV || "live").toLowerCase();
  return mode === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

function makeTicketId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const rand = new Uint32Array(1);
  crypto.getRandomValues(rand);
  const suf = (rand[0] % 10000).toString().padStart(4, "0");
  return `FA-${y}${m}${day}-${hh}${mm}-${suf}`;
}

async function getAccessToken(env) {
  const secret = env.PAYPAL_CLIENT_SECRET || env.PAYPAL_SECRET;
  if (!env.PAYPAL_CLIENT_ID || !secret) {
    throw new Error("Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET");
  }

  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${secret}`);
  const r = await fetch(`${paypalBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const msg = j?.error_description || j?.error || "PayPal token error";
    throw new Error(msg);
  }
  return j.access_token;
}


async function sendPushover(env, { ticketId, subject, body }) {
  if (!env.PUSHOVER_APP_TOKEN || !env.PUSHOVER_USER_KEY) return;
  const msg = `${subject}\n${body}\nTicket: ${ticketId}`;
  await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: env.PUSHOVER_APP_TOKEN,
      user: env.PUSHOVER_USER_KEY,
      message: msg,
      priority: subject.toLowerCase().includes("plant down") ? "1" : "0"
    })
  }).catch(() => {});
}

async function createOrder(env, { amount, itemName, ticketId }) {
  const token = await getAccessToken(env);

  // Build absolute URLs based on current request host
  // We allow overriding with SITE_URL env var for safety.
  const baseUrl = (env.SITE_URL || "").replace(/\/$/, "");

  return await fetch(`${paypalBase(env)}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: ticketId,
          description: itemName,
          amount: {
            currency_code: CONFIG.currency,
            value: amount
          }
        }
      ],
      application_context: {
        brand_name: CONFIG.brandName,
        user_action: "PAY_NOW",
        return_url: `${baseUrl}${CONFIG.returnPath}?ticket=${encodeURIComponent(ticketId)}`,
        cancel_url: `${baseUrl}${CONFIG.cancelPath}`
      }
    })
  });
}

export async function onRequestOptions() {
  // Same-origin from your site, but this avoids preflight weirdness.
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const ct = request.headers.get("content-type") || "";
    let body = {};

    if (ct.includes("application/json")) {
      body = await request.json().catch(() => ({}));
    } else if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
      const fd = await request.formData();
      body = Object.fromEntries(fd.entries());
    }

    // Basic guardrails
    if (!body || !body.email || !body.name || !body.requestType) {
      return json({ ok: false, error: "Missing required fields" }, 400);
    }
    if (String(body.payAck || "").toLowerCase() !== "on" && body.payAck !== true) {
      return json({ ok: false, error: "Payment acknowledgment required" }, 400);
    }

    const tier = (body.pricingTier || "").toLowerCase();
    const plantDown = body.plantDown === true || body.plantDown === "on";

    const isEmergency = tier === "emergency" || plantDown;
    const amount = isEmergency ? CONFIG.emergencyFee : CONFIG.standardFee;
    const itemName = isEmergency
      ? "Emergency Plant-Down Support (Initial Incident)"
      : "Remote Automation Support (Initial Incident)";

    const ticketId = makeTicketId();

    // Ensure return/cancel URLs work even without SITE_URL by deriving from request
    if (!env.SITE_URL) {
      const url = new URL(request.url);
      env = { ...env, SITE_URL: `${url.protocol}//${url.host}` };
    }


    // If a PayPal subscription has already been approved client-side, we don't create a one-time order.
    // We simply log/notify and return a success response.
    
    // Pay Now (hosted button) flow: payment is handled by PayPal hosted checkout.
    // We don't create or capture an order here; we just record/notify the request.
    if (body.payMethod === "paynow_hosted") {
      const subject = (plantDown || tier === "emergency")
        ? "Plant Down support request (Pay Now)"
        : "Support request (Pay Now)";

      const details = [
        `Ticket: ${ticketId}`,
        `Name: ${body.name || ""}`,
        `Company: ${body.company || ""}`,
        `Email: ${body.email || ""}`,
        `Phone: ${body.phone || ""}`,
        `Request: ${body.requestType || ""}`,
        `Platform: ${body.platform || ""}`,
        `Location: ${body.location || ""}`,
        `Asset: ${body.asset || ""}`,
        `Tier: ${tier || ""}`,
        `Plant Down: ${plantDown ? "YES" : "no"}`,
        `Issue: ${body.issue || ""}`,
        `Hosted Button: ${body.hostedButtonId || ""}`
      ].join("\n");

      await notify(env, subject, details).catch(() => {});
      return json({ ok: true, ticketId, redirect: CONFIG.returnPath });
    }

if (body.subscriptionID) {
      const subject = (plantDown || tier === "emergency")
        ? "Plant Down support request (subscription approved)"
        : "Support request (subscription approved)";

      const details = [
        `Name: ${body.name || ""}`,
        `Company: ${body.company || ""}`,
        `Email: ${body.email || ""}`,
        `Phone: ${body.phone || ""}`,
        `Request: ${body.requestType || ""}`,
        `Platform: ${body.platform || ""}`,
        `Location: ${body.location || ""}`,
        `Asset: ${body.asset || ""}`,
        `Tier: ${tier || ""}`,
        `Plant Down: ${plantDown ? "YES" : "no"}`,
        `Issue: ${body.issue || ""}`,
        `SubscriptionID: ${body.subscriptionID}`
      ].join("\n");

      await sendPushover(env, { ticketId, subject, body: details });

      return json({
        ok: true,
        ticketId,
        mode: "subscription",
        redirect: `${env.SITE_URL}${CONFIG.returnPath}?ticket=${encodeURIComponent(ticketId)}`
      });
    }

    const orderRes = await createOrder(env, { amount, itemName, ticketId });
    const orderJson = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok) {
      const msg = orderJson?.message || orderJson?.name || "Could not create PayPal order";
      return json({ ok: false, error: msg, details: orderJson }, 502);
    }

    const approve = Array.isArray(orderJson?.links)
      ? orderJson.links.find((l) => l.rel === "approve")
      : null;

    if (!approve?.href) {
      return json({ ok: false, error: "PayPal approval link missing", details: orderJson }, 502);
    }

    return json({ ok: true, ticketId, paypalUrl: approve.href });
  } catch (err) {
    return json({ ok: false, error: err?.message || "Server error" }, 500);
  }
}

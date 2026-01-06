import { CONFIG } from "./_config.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
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

async function sendPushover(env, { ticketId, title, message, priority }) {
  if (!env.PUSHOVER_APP_TOKEN || !env.PUSHOVER_USER_KEY) return;

  await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: env.PUSHOVER_APP_TOKEN,
      user: env.PUSHOVER_USER_KEY,
      title,
      message: `${message}\nTicket: ${ticketId}`,
      priority: String(priority ?? 0)
    })
  }).catch(() => {});
}

async function createOrder(env, { amount, itemName, ticketId }) {
  const token = await getAccessToken(env);
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
    } else {
      const fd = await request.formData();
      body = Object.fromEntries(fd.entries());
    }

    // Required fields
    if (!body?.email || !body?.name || !body?.requestType || !body?.issue) {
      return json({ ok: false, error: "Missing required fields" }, 400);
    }

    // Normalize tier + plant-down
    const tier = String(body.pricingTier || "standard").toLowerCase();
    const plantDown =
      body.plantDown === true ||
      body.plantDown === "true" ||
      body.plantDown === "on" ||
      tier === "emergency";

    const isEmergency = tier === "emergency" || plantDown;

    const amount = isEmergency ? CONFIG.emergencyFee : CONFIG.standardFee;
    const itemName = isEmergency
      ? "Emergency Plant-Down Support (Initial Incident)"
      : "Remote Automation Support (Initial Incident)";

    const ticketId = makeTicketId();

    // Ensure SITE_URL exists for PayPal return/cancel URLs
    if (!env.SITE_URL) {
      const url = new URL(request.url);
      env = { ...env, SITE_URL: `${url.protocol}//${url.host}` };
    }

    // Send Pushover immediately when request is created
    const title = plantDown ? "PLANT DOWN — Support Request" : "Support Request";
    const msg = [
      `Name: ${body.name || ""}`,
      body.company ? `Company: ${body.company}` : null,
      `Email: ${body.email || ""}`,
      body.phone ? `Phone: ${body.phone}` : null,
      `Request: ${body.requestType || ""}`,
      body.location ? `Location: ${body.location}` : null,
      body.asset ? `Asset: ${body.asset}` : null,
      `Issue: ${body.issue || ""}`,
      `Tier: ${plantDown ? "PLANT_DOWN" : "STANDARD"}`
    ].filter(Boolean).join("\n");

    await sendPushover(env, {
      ticketId,
      title,
      message: msg,
      priority: plantDown ? 1 : 0
    });

    // Create PayPal order and return approval URL
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
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

async function sendPushover(env, { ticketId, subject, body, priority }) {
  if (!env.PUSHOVER_APP_TOKEN || !env.PUSHOVER_USER_KEY) return;

  const msg = `${subject}\n${body}\nTicket: ${ticketId}`;
  await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: env.PUSHOVER_APP_TOKEN,
      user: env.PUSHOVER_USER_KEY,
      message: msg,
      priority: String(priority ?? 0)
    })
  }).catch(() => {});
}

async function createOrder(env, { amount, itemName, ticketId, requestUrl }) {
  const token = await getAccessToken(env);

  // Build absolute URLs for PayPal redirects
  const baseUrl = (env.SITE_URL || `${new URL(requestUrl).origin}`).replace(/\/$/, "");

  const r = await fetch(`${paypalBase(env)}/v2/checkout/orders`, {
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
            value: String(amount)
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

  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.message || j?.name || "Could not create PayPal order";
    throw new Error(msg);
  }

  const approve = Array.isArray(j?.links) ? j.links.find((l) => l.rel === "approve") : null;
  if (!approve?.href) {
    throw new Error("PayPal approval link missing.");
  }

  return { paypalUrl: approve.href };
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
    } else if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
      const fd = await request.formData();
      body = Object.fromEntries(fd.entries());
    }

    // Required fields
    if (!body || !body.email || !body.name || !body.requestType || !body.issue) {
      return json({ ok: false, error: "Missing required fields" }, 400);
    }

    // Tier normalization
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

    // Pushover alert
    const subject = isEmergency ? "PLANT DOWN — Support Request" : "Support Request";
    const msg = [
      `Name: ${body.name}`,
      body.company ? `Company: ${body.company}` : null,
      `Email: ${body.email}`,
      body.phone ? `Phone: ${body.phone}` : null,
      `Type: ${body.requestType}`,
      `Tier: ${isEmergency ? "PLANT_DOWN" : "STANDARD"}`,
      "",
      "Issue:",
      String(body.issue || "").slice(0, 1200)
    ].filter(Boolean).join("\n");

    await sendPushover(env, {
      ticketId,
      subject,
      body: msg,
      priority: isEmergency ? 1 : 0
    });

    // PayPal checkout
    const { paypalUrl } = await createOrder(env, {
      amount,
      itemName,
      ticketId,
      requestUrl: request.url
    });

    return json({ ok: true, ticketId, paypalUrl });

  } catch (err) {
    return json({ ok: false, error: err?.message || "Server error" }, 500);
  }
}
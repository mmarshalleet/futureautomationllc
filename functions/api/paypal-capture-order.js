// functions/api/paypal-capture-order.js
// Captures a PayPal order and logs/alerts on successful payment.

import { PRICING } from "./_config.js";

function paypalApiBase(env) {
  const ppEnv = (env.PAYPAL_ENV || "live").toString().toLowerCase();
  return ppEnv.includes("sand")
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
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

async function readJson(request) {
  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("application/json")) throw new Error("Expected application/json");
  return await request.json();
}

async function logToSheets(env, record) {
  if (!env.SHEETS_WEBHOOK_URL || !env.SHEETS_WEBHOOK_KEY) return { ok: false, skipped: true };

  const r = await fetch(env.SHEETS_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-key": env.SHEETS_WEBHOOK_KEY,
    },
    body: JSON.stringify(record),
  });

  return { ok: r.ok, status: r.status };
}

async function sendPushover(env, message, priority = "0") {
  if (!env.PUSHOVER_APP_TOKEN || !env.PUSHOVER_USER_KEY) return { ok: false, skipped: true };

  const r = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: env.PUSHOVER_APP_TOKEN,
      user: env.PUSHOVER_USER_KEY,
      message,
      priority,
    }),
  });

  return { ok: r.ok, status: r.status };
}

async function sendEmail(env, subject, text) {
  // Optional: Resend
  if (!env.RESEND_API_KEY || !env.EMAIL_TO || !env.EMAIL_FROM) return { ok: false, skipped: true };

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: env.EMAIL_TO,
      subject,
      text,
    }),
  });

  return { ok: r.ok, status: r.status };
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJson(request);
    const orderID = (body.orderID || body.orderId || "").toString().trim();
    const ticketId = (body.ticketId || "").toString().trim();

    if (!orderID) {
      return new Response(JSON.stringify({ ok: false, error: "Missing orderID" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const accessToken = await getAccessToken(env);

    const r = await fetch(`${paypalApiBase(env)}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${accessToken}`,
      },
    });

    const j = await r.json().catch(() => ({}));

    if (!r.ok) {
      return new Response(JSON.stringify({ ok: false, error: j }), {
        status: 502,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // Extract some useful payment info
    const status = j.status || "";
    const pu0 = (j.purchase_units || [])[0] || {};
    const payment = pu0.payments || {};
    const captures = payment.captures || [];
    const capture = captures[0] || {};

    const captureId = capture.id || "";
    const amount = capture.amount?.value || PRICING.incidentFee;
    const currency = capture.amount?.currency_code || PRICING.currency;

    const isCompleted = status === "COMPLETED" || capture.status === "COMPLETED";

    await logToSheets(env, {
      kind: "paypal_capture",
      ticketId,
      orderID,
      status,
      captureId,
      amount,
      currency,
      capturedAt: new Date().toISOString(),
      raw: j,
    });

    if (isCompleted) {
      const msg = [
        "PAYMENT RECEIVED — Support",
        ticketId ? `Ticket: ${ticketId}` : null,
        `Order: ${orderID}`,
        captureId ? `Capture: ${captureId}` : null,
        `Amount: ${amount} ${currency}`,
      ].filter(Boolean).join("\n");

      await sendPushover(env, msg, "1");
      await sendEmail(env, `PAID: Support Request ${ticketId || orderID}`, msg);
    }

    return new Response(JSON.stringify({ ok: true, status, captureId }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

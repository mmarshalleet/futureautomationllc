// functions/api/support-intake.js
//
// PURPOSE
// -------
// This endpoint accepts the support request form payload and returns a server-generated
// ticket id + a checkout URL.
//
// Why we do NOT create PayPal orders here:
// - Keeps this endpoint fast and reliable (no PayPal calls = fewer failures).
// - The checkout page (support-checkout.html) handles PayPal Smart Buttons,
//   which then uses /api/paypal-create-order + /api/paypal-capture-order.
//
// IMPORTANT
// ---------
// Legacy PayPal flows (PAYPAL_BUSINESS / IPN / webscr links) have been removed.
// This site uses PayPal Checkout (client id + secret) only.

import { CONFIG, siteOrigin } from "./_config.js";

async function readJson(request) {
  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error("Expected application/json");
  }
  return await request.json();
}

function normalizeBool(v) {
  return v === true || v === "true" || v === "1" || v === 1 || v === "on";
}

export async function onRequestPost({ request }) {
  try {
    const payload = await readJson(request);

    // The form uses `requestType` (standard/emergency). Some older code used `pricingTier`.
    const pricingTier = (payload.pricingTier || payload.requestType || "standard")
      .toString()
      .toLowerCase();

    const plantDown = normalizeBool(payload.plantDown);

    // Anything marked plant-down is emergency priority.
    const isEmergency = pricingTier === "emergency" || plantDown;

    // These are used for display on the checkout page.
    const amount = isEmergency ? CONFIG.PRICING.emergencyFee : CONFIG.PRICING.standardFee;

    // Ticket id: short, readable, and URL-safe.
    const ticketId = `FA-${Date.now().toString(36).toUpperCase()}`;

    const origin = siteOrigin(request);
    const checkoutUrl = `${origin}/support-checkout.html?ticket=${encodeURIComponent(ticketId)}&plantDown=${plantDown ? "1" : "0"}`;

    return new Response(
      JSON.stringify({
        ok: true,
        ticketId,
        pricingTier: isEmergency ? "emergency" : "standard",
        amount,
        currency: CONFIG.PRICING.currency,
        checkoutUrl,
      }),
      { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || String(err) }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
}

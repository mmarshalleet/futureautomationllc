// functions/api/support-intake.js
import { PRICING, getSiteOrigin, buildPayPalOneTimeUrl } from "./_config.js";

function uid() {
    // short, readable ticket id
    const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
    const ts = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
    return `FA-${ts}-${rand}`;
}

async function readPayload(request) {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) return await request.json();
    const fd = await request.formData();
    const obj = {};
    for (const [k, v] of fd.entries()) obj[k] = v;
    return obj;
}

async function logToSheets(env, record) {
    // Optional: set SHEETS_WEBHOOK_URL + SHEETS_WEBHOOK_KEY (Apps Script below)
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

export async function onRequestPost({ request, env }) {
    try {
        const payload = await readPayload(request);

        const ticketId = uid();

        const requestType = (payload.requestType || payload.type || "").toString().trim();
        const platform = (payload.platform || "").toString().trim();

        const isPlantDown =
            String(payload.plantDown || "").toLowerCase().includes("true") ||
            requestType.toLowerCase().includes("plant down");

        const origin = getSiteOrigin(request);

        // YOU set this in Cloudflare env vars:
        // PAYPAL_BUSINESS (email OR merchant id)
        if (!env.PAYPAL_BUSINESS) {
            return new Response(JSON.stringify({ ok: false, error: "Missing PAYPAL_BUSINESS env var" }), {
                status: 500,
                headers: { "content-type": "application/json; charset=utf-8" },
            });
        }

        // Build PayPal “Pay Now” URL
        const itemName = isPlantDown
            ? "Plant-Down Remote Support (Initial Incident)"
            : requestType
                ? `${requestType} (Initial Incident)`
                : "Remote Support (Initial Incident)";
        const paypalUrl = buildPayPalOneTimeUrl({
            business: env.PAYPAL_BUSINESS,
            itemName,
            amount: PRICING.incidentFee,
            custom: ticketId,
            returnUrl: `${origin}/paid.html?ticket=${encodeURIComponent(ticketId)}`,
            cancelUrl: `${origin}/request-support.html?canceled=1`,
            notifyUrl: `${origin}/api/paypal-ipn`,
        });

        const record = {
            kind: "support_intake",
            ticketId,
            createdAt: new Date().toISOString(),
            plantDown: !!isPlantDown,
            requestType,
            platform,
            name: (payload.name || "").toString().trim(),
            company: (payload.company || "").toString().trim(),
            email: (payload.email || "").toString().trim(),
            phone: (payload.phone || "").toString().trim(),
            location: (payload.location || "").toString().trim(),
            asset: (payload.asset || "").toString().trim(),
            issue: (payload.issue || "").toString().trim(),
            status: "AWAITING_PAYMENT",
            incidentFee: PRICING.incidentFee,
        };

        await logToSheets(env, record);

        const msg = [
            isPlantDown ? "PLANT DOWN — Support Intake (Awaiting Payment)" : "Support Intake (Awaiting Payment)",
            `Ticket: ${ticketId}`,
            requestType ? `Request: ${requestType}` : null,
            platform ? `Platform: ${platform}` : null,
            record.name ? `Name: ${record.name}` : null,
            record.company ? `Company: ${record.company}` : null,
            record.email ? `Email: ${record.email}` : null,
            record.phone ? `Phone: ${record.phone}` : null,
            record.location ? `Location: ${record.location}` : null,
            record.asset ? `Asset: ${record.asset}` : null,
            record.issue ? `Issue: ${record.issue}` : null,
        ].filter(Boolean).join("\n");

        await sendPushover(env, msg, isPlantDown ? "1" : "0");

        return new Response(JSON.stringify({ ok: true, ticketId, paypalUrl }), {
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

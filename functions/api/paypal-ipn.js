// functions/api/paypal-ipn.js

async function parseBody(request) {
    const text = await request.text();
    return { raw: text, params: new URLSearchParams(text) };
}

async function verifyWithPayPal(raw) {
    // PayPal IPN verification step (required)
    const verifyBody = `cmd=_notify-validate&${raw}`;
    const r = await fetch("https://ipnpb.paypal.com/cgi-bin/webscr", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: verifyBody,
    });
    return (await r.text()).trim();
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

async function sendEmail(env, subject, text) {
    // Optional (recommended): Resend
    // Set RESEND_API_KEY + EMAIL_TO + EMAIL_FROM
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
        const { raw, params } = await parseBody(request);
        const verified = await verifyWithPayPal(raw);

        const ticketId = params.get("custom") || "";
        const paymentStatus = params.get("payment_status") || "";
        const txnId = params.get("txn_id") || "";
        const gross = params.get("mc_gross") || params.get("payment_gross") || "";
        const currency = params.get("mc_currency") || "";

        const isCompleted = verified === "VERIFIED" && paymentStatus === "Completed";

        await logToSheets(env, {
            kind: "paypal_ipn",
            verified,
            paymentStatus,
            ticketId,
            txnId,
            gross,
            currency,
            receivedAt: new Date().toISOString(),
            status: isCompleted ? "PAID" : "IGNORED",
        });

        if (isCompleted && ticketId) {
            const subject = `PAID: Support Request ${ticketId}`;
            const text = [
                `Payment completed for ticket ${ticketId}.`,
                `Txn: ${txnId}`,
                `Amount: ${gross} ${currency}`,
                "",
                "Reply to customer and start the clock.",
            ].join("\n");

            await sendEmail(env, subject, text);

            // Optional: also push notify if you want
        }

        // PayPal expects 200 quickly.
        return new Response("OK", { status: 200 });
    } catch (err) {
        return new Response("ERROR", { status: 500 });
    }
}

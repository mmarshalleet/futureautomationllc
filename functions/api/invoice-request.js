function jres(obj, status = 200, cacheControl = "no-store") {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": cacheControl
    }
  });
}

function clean(s, max = 2000) {
  return String(s ?? "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, max);
}

async function sendViaResend(env, subject, text) {
  if (!env.RESEND_API_KEY || !env.INVOICE_TO_EMAIL || !env.INVOICE_FROM_EMAIL) {
    // Don’t crash production if env vars aren’t set
    return { skipped: true, reason: "Missing RESEND_API_KEY / INVOICE_TO_EMAIL / INVOICE_FROM_EMAIL" };
  }

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: env.INVOICE_FROM_EMAIL,   // e.g. "Future Automation <invoices@futureautomationllc.com>"
      to: [env.INVOICE_TO_EMAIL],     // e.g. "contact@futureautomationllc.com"
      subject,
      text
    })
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend error (${r.status}): ${JSON.stringify(data)}`);
  return data;
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return jres({}, 204);
  if (request.method !== "POST") return jres({ error: "Method Not Allowed" }, 405);

  try {
    const body = await request.json().catch(() => null);
    if (!body) return jres({ error: "Invalid JSON" }, 400);

    // Honeypot: if filled, treat as spam
    if (body.website && String(body.website).trim() !== "") {
      return jres({ ok: true }); // pretend success
    }

    const name = clean(body.name, 200);
    const company = clean(body.company, 200);
    const email = clean(body.email, 200);
    const phone = clean(body.phone, 200);
    const shipTo = clean(body.shipTo, 1200);
    const items = clean(body.items, 2000);
    const needBy = clean(body.needBy, 50);
    const urgency = clean(body.urgency, 80);
    const notes = clean(body.notes, 2000);

    if (!name || !email || !shipTo || !items) {
      return jres({ error: "Missing required fields (name, email, ship-to, items)" }, 400);
    }

    const subject = `Invoice request: ${name}${company ? " (" + company + ")" : ""} — ${urgency || "Non-urgent"}`;

    const text =
`New invoice request from futureautomationllc.com

Name: ${name}
Company: ${company}
Email: ${email}
Phone: ${phone}

Ship-to:
${shipTo}

Items:
${items}

Need-by: ${needBy}
Urgency: ${urgency}

Notes:
${notes}

---
IP: ${request.headers.get("cf-connecting-ip") || ""}
UA: ${request.headers.get("user-agent") || ""}
`;

    const sent = await sendViaResend(env, subject, text);

    return jres({ ok: true, sent });
  } catch (e) {
    return jres({ error: String(e) }, 500);
  }
}
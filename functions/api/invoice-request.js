// functions/api/invoice-request.js
// Sends: (1) email to you via Resend (optionally with PDF attachment)
//        (2) logs to Google Sheets via Apps Script webhook
//        (3) SMS alert via T-Mobile email-to-SMS gateway (optional)

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

function truthy(v) {
  return String(v || "").toLowerCase() === "true";
}

async function sendViaResend(env, { to, subject, text, attachments }) {
  if (!env.RESEND_API_KEY) return { skipped: true, reason: "Missing RESEND_API_KEY" };
  if (!env.INVOICE_FROM_EMAIL) return { skipped: true, reason: "Missing INVOICE_FROM_EMAIL" };

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: env.INVOICE_FROM_EMAIL,
      to,
      subject,
      text,
      attachments: attachments && attachments.length ? attachments : undefined
    })
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend error ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

async function logToSheets(env, payload) {
  if (!env.GS_WEBHOOK_URL) return { skipped: true, reason: "Missing GS_WEBHOOK_URL" };

  const r = await fetch(env.GS_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) throw new Error(`Sheets log failed ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

async function sendSmsViaEmail(env, smsText) {
  // Uses carrier gateway email address, e.g. 8708062555@tmomail.net (T-Mobile)
  if (!env.ALERT_SMS_EMAIL) return { skipped: true, reason: "Missing ALERT_SMS_EMAIL" };

  // Keep it SHORT. Carrier gateways are allergic to novels.
  const body = String(smsText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);

  return sendViaResend(env, {
    to: [env.ALERT_SMS_EMAIL],
    subject: "FA Alert",
    text: body
  });
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return jres({}, 204);
  if (request.method !== "POST") return jres({ error: "Method Not Allowed" }, 405);

  try {
    const b = await request.json().catch(() => null);
    if (!b) return jres({ error: "Invalid JSON" }, 400);

    // Honeypot
    if (b.website && String(b.website).trim() !== "") return jres({ ok: true });

    // Basic fields
    const data = {
      name: clean(b.name, 200),
      company: clean(b.company, 200),
      email: clean(b.email, 200),
      phone: clean(b.phone, 200),
      shipTo: clean(b.shipTo, 1200),
      items: clean(b.items, 2000),
      needBy: clean(b.needBy, 50),
      urgency: clean(b.urgency, 80),
      notes: clean(b.notes, 2000),
      pdfFilename: b.pdfFilename ? clean(b.pdfFilename, 200) : "",
      pdfBase64: b.pdfBase64 ? String(b.pdfBase64).trim() : ""
    };

    if (!data.name || !data.email || !data.items || !data.shipTo) {
      return jres({ error: "Missing required fields (name, email, ship-to, items)" }, 400);
    }

    // Optional PDF attachment (base64)
    const attachments = [];
    if (data.pdfBase64 && data.pdfFilename) {
      // light sanity check: base64-ish and filename ends with .pdf
      if (!/\.pdf$/i.test(data.pdfFilename)) {
        return jres({ error: "Attachment must be a PDF" }, 400);
      }
      attachments.push({ filename: data.pdfFilename, content: data.pdfBase64 });
    }

    // Compose email to you
    if (!env.INVOICE_TO_EMAIL) return jres({ error: "Missing INVOICE_TO_EMAIL" }, 500);

    const subject = `Invoice request: ${data.name}${data.company ? ` (${data.company})` : ""} — ${data.urgency || "Non-urgent"}`;

    const text =
`New invoice request from futureautomationllc.com

Name: ${data.name}
Company: ${data.company}
Email: ${data.email}
Phone: ${data.phone}

Ship-to:
${data.shipTo}

Items:
${data.items}

Need-by: ${data.needBy}
Urgency: ${data.urgency}

Notes:
${data.notes}

---
IP: ${request.headers.get("cf-connecting-ip") || ""}
UA: ${request.headers.get("user-agent") || ""}
`;

    // 1) Email you (with optional PDF)
    const emailResult = await sendViaResend(env, {
      to: [env.INVOICE_TO_EMAIL],
      subject,
      text,
      attachments
    });

    // 2) Log to Sheets (and your Apps Script can save PDF to Drive + return pdfUrl)
    let sheetResult = { skipped: true };
    try {
      sheetResult = await logToSheets(env, {
        ...data,
        source: env.GS_SOURCE || "website"
      });
    } catch (e) {
      // Don't fail the whole request if Sheets is down.
      sheetResult = { error: String(e) };
    }

    // 3) SMS alert via email gateway
    const smsOnPlantDown = truthy(env.SMS_ON_PLANT_DOWN);
    const smsOnAll = truthy(env.SMS_ON_ALL_INVOICE_REQUESTS);
    const isPlantDown = (data.urgency || "").toLowerCase().includes("plant down");

    let smsResult = { skipped: true, reason: "Not triggered" };
    if ((smsOnPlantDown && isPlantDown) || smsOnAll) {
      const smsText =
        `FA ${isPlantDown ? "PLANT DOWN 🚨" : (data.urgency || "Request")}: ` +
        `${data.name}${data.company ? ` (${data.company})` : ""} — ` +
        `${data.items.replace(/\s+/g, " ").slice(0, 80)}${data.items.length > 80 ? "…" : ""}`;

      try {
        smsResult = await sendSmsViaEmail(env, smsText);
      } catch (e) {
        smsResult = { error: String(e) };
      }
    }

    return jres({ ok: true, emailResult, sheetResult, smsResult });
  } catch (e) {
    return jres({ error: String(e) }, 500);
  }
}
// functions/api/consult-request.js
// Sends: (1) email to you via Resend
//        (2) optional log to Google Sheets via Apps Script webhook
//        (3) optional SMS alert via email-to-SMS gateway

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

async function sendViaResend(env, { to, subject, text }) {
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
      text
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
  if (!env.ALERT_SMS_EMAIL) return { skipped: true, reason: "Missing ALERT_SMS_EMAIL" };

  const body = String(smsText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);

  return sendViaResend(env, {
    to: [env.ALERT_SMS_EMAIL],
    subject: "FA Consult",
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

    const data = {
      name: clean(b.name, 200),
      company: clean(b.company, 200),
      email: clean(b.email, 200),
      phone: clean(b.phone, 200),
      service: clean(b.service, 200),
      timeline: clean(b.timeline, 120),
      location: clean(b.location, 240),
      assets: clean(b.assets, 1200),
      problem: clean(b.problem, 2000),
      existingData: clean(b.existingData, 2000),
      notes: clean(b.notes, 2000)
    };

    if (!data.name || !data.email || !data.problem || !data.service) {
      return jres({ error: "Missing required fields (name, email, consult type, problem)" }, 400);
    }

    const toEmail = env.CONSULT_TO_EMAIL || env.INVOICE_TO_EMAIL;
    if (!toEmail) return jres({ error: "Missing CONSULT_TO_EMAIL (or INVOICE_TO_EMAIL)" }, 500);

    const subject = `Consult request: ${data.service} — ${data.name}${data.company ? ` (${data.company})` : ""}`;

    const text =
`New consult request from futureautomationllc.com

Service: ${data.service}
Timeline: ${data.timeline}

Name: ${data.name}
Company: ${data.company}
Email: ${data.email}
Phone: ${data.phone}

Plant/Location:
${data.location}

Equipment/Area:
${data.assets}

Problem / Goal:
${data.problem}

Existing data available:
${data.existingData}

Notes:
${data.notes}

---
IP: ${request.headers.get("cf-connecting-ip") || ""}
UA: ${request.headers.get("user-agent") || ""}
`;

    const emailResult = await sendViaResend(env, {
      to: [toEmail],
      subject,
      text
    });

    let sheetResult = { skipped: true };
    try {
      sheetResult = await logToSheets(env, {
        ...data,
        type: "consult",
        source: env.GS_SOURCE || "website"
      });
    } catch (e) {
      sheetResult = { error: String(e) };
    }

    let smsResult = { skipped: true, reason: "Not triggered" };
    if (truthy(env.SMS_ON_ALL_CONSULT_REQUESTS)) {
      const smsText = `FA consult: ${data.service} — ${data.name}${data.company ? ` (${data.company})` : ""}`;
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

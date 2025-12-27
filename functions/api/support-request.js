// functions/api/support-request.js
// Cloudflare Pages Function
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
  if (!env.SUPPORT_FROM_EMAIL) return { skipped: true, reason: "Missing SUPPORT_FROM_EMAIL" };

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: env.SUPPORT_FROM_EMAIL,
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
    subject: "FA Support",
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
      requestType: clean(b.requestType, 80),
      urgency: clean(b.urgency, 60),
      preferredContact: clean(b.preferredContact, 40),
      name: clean(b.name, 200),
      company: clean(b.company, 200),
      email: clean(b.email, 200),
      phone: clean(b.phone, 200),
      location: clean(b.location, 240),
      system: clean(b.system, 600),
      symptoms: clean(b.symptoms, 2000),
      impact: clean(b.impact, 1000),
      timeline: clean(b.timeline, 120),
      notes: clean(b.notes, 2000)
    };

    if (!data.name || !data.email || !data.requestType || !data.symptoms) {
      return jres({ error: "Missing required fields (name, email, request type, details)" }, 400);
    }

    const toEmail = env.SUPPORT_TO_EMAIL || env.CONSULT_TO_EMAIL || env.INVOICE_TO_EMAIL;
    if (!toEmail) return jres({ error: "Missing SUPPORT_TO_EMAIL (or fallback email)" }, 500);

    const subject = `Support request: ${data.requestType} — ${data.urgency || "New"} — ${data.name}${data.company ? ` (${data.company})` : ""}`;

    const text =
`New support request from futureautomationllc.com

Request type: ${data.requestType}
Urgency: ${data.urgency}
Preferred contact: ${data.preferredContact}

Name: ${data.name}
Company: ${data.company}
Email: ${data.email}
Phone: ${data.phone}

Plant/Location:
${data.location}

System / Area:
${data.system}

Issue / Symptoms:
${data.symptoms}

Business impact:
${data.impact}

Timeline:
${data.timeline}

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
        type: "support",
        source: env.GS_SOURCE || "website"
      });
    } catch (e) {
      sheetResult = { error: String(e) };
    }

    let smsResult = { skipped: true, reason: "Not triggered" };
    const isPlantDown = String(data.urgency || "").toLowerCase().includes("down");
    if (truthy(env.SMS_ON_ALL_SUPPORT_REQUESTS) || (isPlantDown && truthy(env.SMS_ON_PLANT_DOWN))) {
      const smsText = `FA ${data.urgency || "Support"}: ${data.requestType} — ${data.name}${data.company ? ` (${data.company})` : ""}`;
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

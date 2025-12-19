function jres(obj, status=200){
  return new Response(JSON.stringify(obj),{
    status,
    headers:{ "content-type":"application/json" }
  });
}

function clean(s,max=2000){
  return String(s??"").replace(/\r/g,"").trim().slice(0,max);
}

async function sendViaResend(env, subject, text, attachments){
  if(!env.RESEND_API_KEY) return { skipped:true };

  const r = await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{
      "authorization":`Bearer ${env.RESEND_API_KEY}`,
      "content-type":"application/json"
    },
    body:JSON.stringify({
      from: env.INVOICE_FROM_EMAIL,
      to: [env.INVOICE_TO_EMAIL],
      subject,
      text,
      attachments
    })
  });

  const j = await r.json();
  if(!r.ok) throw new Error(JSON.stringify(j));
  return j;
}

async function logToSheets(env, payload){
  if(!env.GS_WEBHOOK_URL) return;
  await fetch(env.GS_WEBHOOK_URL,{
    method:"POST",
    headers:{ "content-type":"application/json" },
    body: JSON.stringify(payload)
  });
}

export async function onRequest({ request, env }){
  if(request.method!=="POST") return jres({error:"Method not allowed"},405);

  try{
    const b = await request.json();

    if(b.website) return jres({ok:true}); // honeypot

    const data = {
      name: clean(b.name,200),
      company: clean(b.company,200),
      email: clean(b.email,200),
      phone: clean(b.phone,200),
      shipTo: clean(b.shipTo,1200),
      items: clean(b.items,2000),
      needBy: clean(b.needBy,50),
      urgency: clean(b.urgency,80),
      notes: clean(b.notes,2000),
      pdfFilename: b.pdfFilename,
      pdfBase64: b.pdfBase64
    };

    if(!data.name || !data.email || !data.items || !data.shipTo){
      return jres({error:"Missing required fields"},400);
    }

    const attachments = [];
    if(data.pdfBase64 && data.pdfFilename){
      attachments.push({
        filename: data.pdfFilename,
        content: data.pdfBase64
      });
    }

    const subject = `Invoice request: ${data.name} — ${data.urgency}`;
    const text =
`Invoice request

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
`;

    await sendViaResend(env, subject, text, attachments);
    await logToSheets(env, { ...data, source:"website" });

    return jres({ok:true});
  }catch(e){
    return jres({error:String(e)},500);
  }
}
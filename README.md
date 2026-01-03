# Future Automation LLC

Uptime-focused industrial automation support for maintenance teams.

## What this site is
This repo powers **futureautomationllc.com** — a simple, fast static site hosted on Cloudflare Pages with a few serverless endpoints for forms.

## What we do
- **Plant-down support** (PLCs, HMIs, VFDs, sensors, safety, panels)
- **Repeat-stop elimination** (find the root cause, make it stick)
- **Retrofits & migrations** (clean, documented upgrades)
- **Condition monitoring** (practical rollout, trend-based alerts)

## Key pages
- `index.html` – homepage
- `services.html` – services overview
- `condition-monitoring.html` – condition monitoring offering
- `request-support.html` – support request form
- `equipment.html` – surplus equipment

## Serverless endpoints (Cloudflare Pages Functions)
- `functions/api/notify.js`  
  Receives support requests from the site form and forwards them to email/SMS (depending on your env setup).

## Local dev
You can preview it with any static server.

```bash
# from the repo root
python3 -m http.server 8787
```

Then open `http://localhost:8787`.

## Deploy
Push to the default branch and Cloudflare Pages will build and deploy.

## Notes
- Keep assets in the root for simple paths (`/style.css`, `/logo.svg`, etc.).
- If you rename pages, update links in the nav/footer so nothing 404s.

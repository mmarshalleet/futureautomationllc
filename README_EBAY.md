# eBay integration & Marketplace Account Deletion webhook — instructions

Summary:
- Deploy serverless functions under `/api/ebay` and `/api/ebay-deletion`.
- Set environment variables in your hosting platform (e.g. Vercel).
- Register the webhook endpoint and the same verification token in eBay Developer portal (Production keyset).

Required environment variables (do NOT commit these):
- EBAY_CLIENT_ID          (production App ID / Client ID)
- EBAY_CLIENT_SECRET      (production Cert ID / Client Secret)
- EBAY_ENV                (optional; default: production)
- EBAY_SELLER             (optional: default seller username to show in equipment page)
- VERIFICATION_TOKEN      (32–80 char random secret: you provide this to eBay when registering webhook)
- WEBHOOK_ENDPOINT_URL    (exact HTTPS URL you register in eBay, e.g. https://your-domain.com/api/ebay-deletion)
- GETFORM_URL             (optional; your getform.io endpoint to forward deletion notifications)

Deploy:
1. Create a branch:
   git checkout -b feature/ebay-integration

2. Add files to repo under `api/` and update equipment.html.

3. Commit & push:
   git add api/ebay.js api/ebay-deletion.js equipment.html README_EBAY.md
   git commit -m "Add eBay Browse proxy and account-deletion webhook handler"
   git push --set-upstream origin feature/ebay-integration

4. On Vercel (or similar), set the environment variables listed above in Project Settings.

Register the webhook with eBay (production):
1. Use the exact WEBHOOK_ENDPOINT_URL (must be HTTPS).
2. Provide the same VERIFICATION_TOKEN in the registration form.
3. eBay will call your URL with a query parameter `challenge_code`. Your endpoint must compute:
   sha256(challenge_code + VERIFICATION_TOKEN + WEBHOOK_ENDPOINT_URL)
   and return JSON:
   { "challengeResponse": "<hex>" }
4. If the response matches, eBay verifies the endpoint and enables the keyset.

Testing locally (optional):
- Use ngrok to expose local server:
  ngrok http 3000
- Set WEBHOOK_ENDPOINT_URL to the ngrok URL + path (e.g. https://abcd.ngrok.io/api/ebay-deletion) in your eBay registration.
- Start your local dev server so that the endpoint responds to eBay's verification request.

Quick check using curl (simulate eBay challenge locally):
1. Suppose VERIFICATION_TOKEN="secret123", ENDPOINT="https://example.com/api/ebay-deletion", challenge_code="abc"
2. local hash (you can compute on your machine):
   echo -n "abcsecret123https://example.com/api/ebay-deletion" | sha256sum
3. Call the endpoint to see it returns the same value:
   curl 'https://example.com/api/ebay-deletion?challenge_code=abc'

Notes & recommendations:
- Production: implement signature verification of POST notifications (eBay provides a signature header / JWKS). I can add that code if you want it now.
- Keep the VERIFICATION_TOKEN secret. Use a good random generator:
  - openssl rand -hex 32
  - or Node: require('crypto').randomBytes(24).toString('hex')
- After eBay verifies your endpoint, the disabled message in your developer keyset should disappear within a short time.

If you want, I will:
- produce a ready git patch (git apply) that creates these files in one step (I can paste the patch content for you to apply), OR
- add signature verification using eBay's JWKS and 'jose' (recommended for production), OR
- produce a Netlify functions variant if you use Netlify instead of Vercel.

Tell me which of the above you prefer and I’ll give the patch or add signature verification next.

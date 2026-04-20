# CSG Learning Hub — Setup Checklist

Remaining setup tasks after deployment.

---

## Google Search Console

Helps Google index your site faster and lets you monitor search performance.

1. Go to [Google Search Console](https://search.google.com/search-console)
2. Click **Add Property**
3. Choose **URL prefix** and enter `https://learn.codeschoolofguam.com`
4. **Verify ownership** (pick one):
   - **DNS TXT Record** (recommended): Add the TXT record Google gives you to your DNS settings
   - **HTML Meta Tag** (faster): Add the meta tag to `web/index.html` `<head>` and redeploy
5. Go to **Sitemaps** in the left sidebar
6. Enter `https://learn.codeschoolofguam.com/sitemap.xml` and click Submit
7. Optionally go to **URL Inspection** and request indexing for your main pages

### What to monitor
- **Coverage**: Which pages are indexed
- **Performance**: Search queries, clicks, impressions
- **Core Web Vitals**: Page speed metrics

---

## PostHog Analytics

If not already configured:

1. Sign up at [posthog.com](https://posthog.com) (free: 1M events/month)
2. Create a new project
3. Copy the **Project API Key** from Project Settings
4. Add to **Netlify** environment variables:
   - `VITE_PUBLIC_POSTHOG_KEY` = your key
   - `VITE_PUBLIC_POSTHOG_HOST` = `https://us.i.posthog.com`
5. Redeploy

---

## OG Image (Social Sharing)

When someone shares `learn.codeschoolofguam.com` on social media, Discord, Slack, etc., this image shows up.

1. Create a 1200x630px image with CSG branding
2. Save as `web/public/og-image.png`
3. Redeploy

---

## PWA Icons

Already generated from `CSG-Logo.png`. If you update the logo:

```bash
cd web/public
magick CSG-Logo.png -resize 512x512 icon-512x512.png
magick CSG-Logo.png -resize 192x192 icon-192x192.png
magick CSG-Logo.png -resize 180x180 icon-180x180.png
magick CSG-Logo.png -resize 32x32 favicon-32x32.png
magick CSG-Logo.png -resize 16x16 favicon-16x16.png
magick favicon-32x32.png favicon-16x16.png favicon.ico
```

## PWA Push Notifications

Phase 4 announcements and messages can send browser push notifications after the app has VAPID keys configured.

1. Generate keys from the API directory:

   ```bash
   bundle exec rails runner 'keys = WebPush.generate_key; puts keys.public_key; puts keys.private_key'
   ```

2. Add the values to Render:
   - `WEB_PUSH_PUBLIC_KEY`
   - `WEB_PUSH_PRIVATE_KEY`
   - `WEB_PUSH_SUBJECT` = `mailto:leon@codeschoolofguam.com`

3. Add the public key to Netlify:
   - `VITE_WEB_PUSH_PUBLIC_KEY` = the same value as `WEB_PUSH_PUBLIC_KEY`

4. Redeploy API and web.

5. In the installed PWA, sign in and use **Announcements → Turn on push** or **Messages → Turn on push**.

Notes:
- iOS push requires installing the site to the home screen first.
- Push notifications intentionally use safe summary text by default.
- Users must opt in per browser/device.

## Realtime Messages

Phase 4 channel messages use ActionCable at `/cable`. Make sure the API allows the deployed web origin:

- `FRONTEND_URL` or `ALLOWED_ORIGINS` on Render should include the Netlify app URL.
- `VITE_API_URL` on Netlify should point at the Render API URL so the PWA opens the matching `wss://.../cable` connection.

The current production cable adapter is in-process `async`, which is fine for one Render web instance. Move to Redis-backed cable before running multiple API instances.

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

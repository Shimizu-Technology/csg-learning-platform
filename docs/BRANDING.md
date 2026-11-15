# School and product configuration

Branding shares the API's `config.x.school` container with `SCHOOL_TIME_ZONE`.
API values load at boot in `lib/school_brand.rb`; restart after changing them.
Web values load at build time in `web/src/lib/brand.ts`; rebuild and redeploy.
Mobile values load at build time in `mobile/src/lib/brand.ts`; rebuild the app.
These values are public configuration, never secrets. Set corresponding values in
all deployed layers; a session response does not replace public build settings.

| Setting | API ENV | Web ENV | Mobile ENV | Default |
| --- | --- | --- | --- | --- |
| School name | `SCHOOL_NAME` | `VITE_SCHOOL_NAME` | `EXPO_PUBLIC_SCHOOL_NAME` | `Code School of Guam` |
| Product name | `PRODUCT_NAME` | `VITE_PRODUCT_NAME` | `EXPO_PUBLIC_PRODUCT_NAME` | `CSG Learn` |
| Abbreviation | `SCHOOL_ABBREVIATION` | `VITE_SCHOOL_ABBREVIATION` | `EXPO_PUBLIC_SCHOOL_ABBREVIATION` | `CSG` |
| Short school name | `SCHOOL_SHORT_NAME` | `VITE_SCHOOL_SHORT_NAME` | `EXPO_PUBLIC_SCHOOL_SHORT_NAME` | `Code School` |
| Support email | `SUPPORT_EMAIL` | `VITE_SUPPORT_EMAIL` | `EXPO_PUBLIC_SUPPORT_EMAIL` | `codeschoolofguam@gmail.com` |
| Public school site | `SCHOOL_SITE_URL` | `VITE_SCHOOL_SITE_URL` | `EXPO_PUBLIC_SCHOOL_SITE_URL` | `https://codeschoolofguam.com/` |
| Courses URL | — | `VITE_SCHOOL_COURSES_URL` | — | `courses` resolved against school site (`https://codeschoolofguam.com/courses`) |
| Public app URL | `SCHOOL_APP_URL` | `VITE_APP_URL` | `EXPO_PUBLIC_APP_URL` | `https://learn.codeschoolofguam.com` for policy/client links |
| Sender display name | `EMAIL_SENDER_NAME` | — | — | No override; existing sender display name is preserved |
| Sender mailbox | `RESEND_FROM_EMAIL`, then `MAILER_FROM_EMAIL` | — | — | Existing deployment setting, no new fallback mailbox |
| Legal operator | — | `VITE_OPERATOR_NAME` | — | `Shimizu Technology` |
| Privacy contact | — | `VITE_PRIVACY_EMAIL` | — | `shimizutechnology@gmail.com` |
| Legacy redirect source origin | — | `VITE_LEGACY_APP_URL` | — | `https://csg-learn.netlify.app` |
| Web logo | — | `VITE_LOGO_SRC` | — | `/CSG-Logo.png` |
| In-app mobile logo SVG | — | — | `EXPO_PUBLIC_LOGO_SVG` | Existing generated `assets/brand/csg-mark.svg` |

Values are trimmed; blank URLs use defaults. Invalid URLs fail API boot or client builds.
Brand/policy links use only SCHOOL_APP_URL, independent of CORS list order and
PUBLIC_FRONTEND_URL. Use an absolute HTTPS app origin without a path. Use a trailing slash for the
school site URL. Web link labels derive their hostname from the school site.
Email delivery/invitations still use `FrontendUrlResolver` (its development
fallback is `http://localhost:5173`). CORS continues to use the existing
`FRONTEND_URL` / `ALLOWED_ORIGINS` settings; public branding does not widen it.
An existing sender such as `CSG <notifications@example.com>` is returned exactly
as configured unless `EMAIL_SENDER_NAME` is set, which replaces its display name
and retains its mailbox. Configure a verified sender domain with your provider.

`POST /api/v1/sessions` includes `school.name`, `product_name`, `support_email`,
and `site_url`, alongside the existing timezone fields. Client types accept these
fields; public and signed-in display copy uses the build configuration consistently.
Older cached mobile sessions without branding remain valid.

## Web metadata and assets

The Vite brand plugin renders `index.html` and files in `web/brand-public/` from
the same `createBrand` values: title, SEO/social metadata, structured data,
boot/no-script copy, manifest, offline page, push fallback title, robots, sitemap,
and canonical redirect target. It serves generated assets during development too.
Templates escape HTML, XML, JSON and single-quoted JavaScript values. Only Git-tracked, non-dotfiles are emitted. Keep placeholders in source templates.

Replace `web/public/og-image.png` and the existing favicon/PWA icon assets when
rebranding; their paths and dimensions remain unchanged. `VITE_LOGO_SRC` controls
the displayed school mark, not those separate image assets. Set `VITE_LEGACY_APP_URL` when moving away from the CSG Netlify site;
that hostname identifies an existing deployment, not display branding.

## Native identity and artwork checklist

This PR deliberately preserves signing and store identities. A new school must:

1. Register its own Apple bundle ID and Android package, provisioning profiles,
   signing keys, store listings, and push credentials. Keep credentials private.
2. Change `mobile/app.json` name, slug, scheme, `ios.bundleIdentifier`,
   `ios.infoPlist.CFBundleName`, and `android.package` for the new app. Update
   Clerk redirect/deep-link configuration to match its scheme and domains.
3. Create its own EAS project and update project IDs/profiles in app/EAS config.
   Regenerate native projects through the project's Expo workflow; review native
   identifiers, entitlements, associated domains, and notification configuration.
4. Replace source artwork under `mobile/assets/brand/`, adapt the asset generator
   for the new mark, and run `npm run brand:generate` and `npm run brand:check`.
   Review generated app icons, splash screens, notification icons and store art.
   The in-app SVG override does not replace compiled native/store artwork.

The alumni GitHub organization `Code-School-of-Guam-Alumni` is an external data
identifier, not a school label. Configure cohort GitHub organizations for the new
school rather than renaming that organization implicitly. Existing database
cohort/workspace names and demo fixtures are data, not configuration defaults.

## Remaining scope and checks

Colors are unchanged. Current web colors live in `web/src/index.css` and
`web/src/lib/brand.ts` (surface chrome); native roles live in
`mobile/src/constants/csg-theme.ts`. Email colors are inline in email services.

The concurrent Messages refactor is excluded: `web/src/pages/shared/Messages.tsx`
and `web/src/pages/shared/messages/*` remain untouched. Follow-up replacements:
`useMessagesController.tsx` has “Report received. Code School staff will review
it.” and “User report received. Code School staff will review it.”

Web's brand configuration test scans source literals using the TypeScript parser;
its explicit exceptions are brand.ts, tests, Markdown conformance fixtures, and
those concurrent Messages paths. Comments are not UI literals. The API test scans
application Ruby, ERB and Rake outside comments (curriculum seed data explicitly excluded). Both fail when school/product literals return.

The mobile literal guard is deferred: generated SVG artwork and native identity strings need a separate allow-list.

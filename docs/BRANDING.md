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
| Legal operator URL | — | `VITE_OPERATOR_URL` | — | `https://shimizu-technology.com` when operator is `Shimizu Technology`; omitted for alternate operators unless set |
| Privacy contact | — | `VITE_PRIVACY_EMAIL` | — | `shimizutechnology@gmail.com` |
| SEO keywords | — | `VITE_META_KEYWORDS` | — | CSG default includes `guam`; alternate schools default to generic coding-school keywords without `guam` |
| JSON-LD `areaServed` | — | `VITE_AREA_SERVED` | — | `Guam` for default CSG; omitted from JSON-LD for alternate schools unless set |
| Legacy redirect source origin | — | `VITE_LEGACY_APP_URL` | — | `https://csg-learn.netlify.app` |
| Web logo | — | `VITE_LOGO_SRC` | — | `/CSG-Logo.png` |
| In-app mobile logo SVG | — | — | `EXPO_PUBLIC_LOGO_SVG` | Existing generated `assets/brand/csg-mark.svg` |

Values are trimmed; blank URLs use defaults. Invalid URLs fail API boot or client builds.
Brand/policy links use only SCHOOL_APP_URL, independent of CORS list order and
PUBLIC_FRONTEND_URL. Use an absolute HTTPS app origin without a path. Use a trailing slash for the
school site URL. Web link labels derive their hostname from the destination URL.
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

Replace these web static image assets when rebranding (their paths and dimensions remain unchanged; `VITE_LOGO_SRC` controls the displayed in-app school mark, not these separate metadata/PWA assets):

- `web/public/og-image.png` (Open Graph / social preview card)
- `web/public/favicon.ico`, `web/public/favicon-16x16.png`, `web/public/favicon-32x32.png`
- `web/public/icon-180x180.png` (iOS `apple-touch-icon`)
- `web/public/icon-192x192.png`, `web/public/icon-512x512.png` (PWA manifest icons)

Set `VITE_LEGACY_APP_URL` when moving away from the CSG Netlify site; that hostname identifies an existing deployment, not display branding. Set `VITE_OPERATOR_URL` only if you want the desktop sidebar footer (`Built by <operatorName>`) to link to an external HTTPS site; changing `VITE_OPERATOR_NAME` without `VITE_OPERATOR_URL` renders plain text rather than linking to Shimizu Technology.

## Native identity, permissions, and artwork checklist

CSG's signing, bundle IDs, EAS project, and current `mobile/app.json` / `mobile/eas.json` outputs are deliberately preserved so existing native builds and EAS Update runtime fingerprints remain compatible. Launching a separate school's native app is an operator build checklist, not a CSG provisioning change:

1. Register the new school's Apple bundle ID, Android package, provisioning profiles, signing keys, store listings, and APNs/FCM push credentials. Keep credentials private and out of Git.
2. Update `mobile/app.json` for the new school:
   - `expo.name`, `expo.slug`, `expo.scheme`
   - `expo.ios.bundleIdentifier`, `expo.ios.infoPlist.CFBundleName`, `expo.ios.appleTeamId`, `expo.ios.associatedDomains` (matching the new HTTPS app origin and its `/.well-known/apple-app-site-association` file)
   - `expo.android.package` and `expo.android.googleServicesFile`
   - Plugin permission copy: `expo-image-picker` `photosPermission` and `expo-audio` `microphonePermission` (currently name `CSG Learn`)
   - Update Clerk redirect/deep-link allowlists to match the new scheme and domain.
3. Create the new school's EAS project and update `expo.extra.eas.projectId`, `expo.updates.url`, `expo.owner`, and `mobile/eas.json` submission/profile IDs. Any change to `mobile/app.json` or `mobile/eas.json` changes the Expo fingerprint runtime and requires a new native binary (never OTA to an older binary).
4. Replace source artwork under `mobile/assets/brand/`, adapt `mobile/scripts/generate-brand-assets.mjs` for the new mark, and run `npm run brand:generate` and `npm run brand:check`. Review generated app icons (`icon.png`, `icon-light.png`, `icon-dark.png`, `icon-tinted.png`, `icon-foreground.png`, `icon-monochrome.png`), splash screens (`splash-icon.png`, `splash-icon-dark.png`), notification icon (`notification-icon.png`), favicon, and store artwork. The `EXPO_PUBLIC_LOGO_SVG` override replaces only the in-app vector mark, not compiled native/store artwork.

## Palette source locations

Colors are not controlled by environment variables. When rebranding the visual palette, update these source locations together:

- Web design tokens and public surface colors: `web/src/index.css`
- Web browser chrome / `meta[name="theme-color"]`: `web/src/lib/themeColors.ts` and the pre-hydration inline script + `#boot-shell` styles + `msapplication-TileColor` in `web/index.html`
- Web PWA / offline shell: `web/brand-public/manifest.json` (`theme_color`, `background_color`) and `web/brand-public/offline.html`
- Mobile UI tokens: `mobile/src/constants/csg-theme.ts`
- Mobile native shell colors: `mobile/app.json` (`android.adaptiveIcon.backgroundColor`, `expo-splash-screen` light/dark `backgroundColor`, `expo-notifications` `color`)
- Transactional emails: inline styles in `api/app/services/*_email*.rb`

## Alternate-brand verification

1. **Web build check:** build `web/` with alternate `VITE_*` values and inspect `web/dist/index.html` plus `web/dist/{manifest.json,offline.html,robots.txt,sitemap.xml,sw.js,_redirects}`:
   - Parse every `<script type="application/ld+json">` block and confirm valid JSON with no `"Guam"` `areaServed` unless `VITE_AREA_SERVED` was explicitly set.
   - Confirm `<meta name="keywords">` omits `guam` unless `VITE_META_KEYWORDS` sets it.
   - Confirm `<title>`, OG/Twitter tags, canonical URL, boot shell, and noscript copy reflect the alternate school/product/support email.
   - Confirm desktop sidebar footer uses `VITE_OPERATOR_NAME` and omits any `shimizu-technology.com` link when `VITE_OPERATOR_URL` is unset for an alternate operator.
2. **Mobile build check:** export `mobile/` with alternate `EXPO_PUBLIC_*` values (`npx expo config --type public --json`, `npx expo export --platform ios --clear`, `npx expo export --platform android --clear` — pass `--clear` whenever `EXPO_PUBLIC_*` values change so Metro does not reuse cached inline strings) and run `npm test` (`brand.test.ts` and `ota-update-notice.test.tsx`). For a rebranded native release, also verify `npm run brand:check` and signed archive entitlements/AASA per `docs/MOBILE_APP.md`.
3. **API check:** verify `SCHOOL_*`, `PRODUCT_NAME`, `SUPPORT_EMAIL`, `SCHOOL_TIME_ZONE`, and `EMAIL_SENDER_NAME` via `bin/rails test test/lib_school_brand_test.rb`.

The alumni GitHub organization `Code-School-of-Guam-Alumni` is an external data
identifier, not a school label. Configure cohort GitHub organizations for the new
school rather than renaming that organization implicitly. Existing database
cohort/workspace names and demo fixtures are data, not configuration defaults.

## Existing channel descriptions

Channel descriptions are stored data. Changing `SCHOOL_NAME` sets the default
for newly created alumni channels; it does not rewrite existing descriptions,
even when they exactly match the previous brand's default text. CSG's default
text is unchanged, so no production data migration is needed. When rebranding,
review existing alumni channels and edit their descriptions through the staff
channel-management UI (Manage Communications), saving the desired school name
or custom wording. Preserve any descriptions that should remain unchanged.

## Remaining intentional static values and checks

- External/data identifiers intentionally preserved: `Cohort::ALUMNI_GITHUB_ORGANIZATION` (`Code-School-of-Guam-Alumni`), `HAFA_CODE_ORIGIN` (`https://code.shimizu-technology.com`), `web/src/pages/admin/cohortSettings/SettingsFields.tsx` GitHub org placeholder, and `mobile/src/lib/native-content-href.ts` legacy CSG origin allowlist entry alongside `brand.appUrl`.
- Technical storage/cache keys intentionally preserved for client upgrade compatibility (not user-visible): `csg-learn:*` `localStorage` keys, `csg-learn-shell-v4` / `csg-learn-runtime-v4` service worker cache names, `csg-learning-v1` mobile query cache buster.
- Voice transcription prompt hint: `OpenaiVoiceProvider::VOCABULARY` (non-UI speech-to-text vocabulary).
- Native identity in `mobile/app.json` and `mobile/eas.json` remains CSG's until a separate school's operator build is provisioned.
- Web's brand configuration test (`web/src/lib/brandConfig.test.tsx`) scans source literals and `index.html` / `brand-public/` templates using the TypeScript parser; explicit exceptions are `brand.ts`, `markdownFixtures.ts`, `hafaStarterLinks.ts`, and tests.
- Mobile's brand test (`mobile/src/lib/__tests__/brand.test.ts`) scans `mobile/src/` runtime files for hardcoded school/product literals outside its explicit allowlist (`brand.ts`, `brand-mark.ts`, `school-time.ts`, `hafa-starter-links.ts`, `native-content-href.ts`, `demo-*.ts`, tests, and test-utils).
- API's brand test (`api/test/lib_school_brand_test.rb`) scans application Ruby, ERB, and Rake outside comments (curriculum seed data excluded).

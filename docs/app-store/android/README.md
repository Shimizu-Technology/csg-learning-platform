# CSG Connect — Google Play Release Runbook

Last updated: 2026-08-17 (Pacific/Guam)

This directory is the source of truth for the first Google Play release of CSG Connect. It records the release state without storing passwords, private student data, signing keys, service-account JSON, or reviewer credentials.

## Current state

| Item | State |
| --- | --- |
| Application ID | `com.codeschoolofguam.connect` |
| Marketing version | `1.0.0` |
| Android version code | Local fallback `2`; latest EAS production artifact `3` (remote auto-increment) |
| Target SDK | API 36, confirmed in the current production AAB and required for new submissions beginning 2026-08-31 |
| Minimum SDK | API 24 |
| Developer account | Existing account owned by `shimizutechnology@gmail.com`; currently Personal |
| Public developer name | Play Console currently shows `Shimizu Technology`; confirm the public listing has propagated before launch |
| Website verification | `shimizu-technology.com` is verified in Search Console and Play Console shows the website as verified |
| Organization conversion | Ready to begin only after the owner supplies the exact D-U-N-S-backed legal organization profile and confirms the public contact details |
| Target audience | Youngest current student confirmed as 15; Play's `13–15` bracket is required, with older brackets pending confirmation of the full intended enrollment range |
| Play app record | Not created yet |
| Android push | Dedicated Firebase project and Android app are registered; the client config is wired into Expo and a least-privilege FCM V1 service-account key is assigned in EAS. Physical-device delivery remains unverified |
| Android toolchain | API 36 SDK, Play Store emulator, debug install/sign-in smoke test, and release-manifest inspection completed locally |
| Production artifact | EAS version-code 3 AAB built from the reviewed commit and inspected locally; not uploaded to Play |
| Internal release | Not uploaded yet |

The older EAS version-code 2 AAB is an audit artifact only and must not be uploaded to Play. It predates release hardening and contains `SYSTEM_ALERT_WINDOW`, legacy external-storage permissions, and `allowBackup=true`. The replacement version-code 3 AAB validates successfully, targets API 36 with minimum API 24, disables backup, excludes blocked legacy/media/overlay permissions and development-client components, includes Firebase Messaging, embeds the production API/Clerk configuration with demo mode disabled, and passes 16 KB ZIP and arm64 ELF alignment checks.

Do not create a second Play developer account. Convert the existing account so the current account history and existing app remain together.

## Release sequence

1. Completed 2026-08-17: verified `shimizu-technology.com` in Google Search Console using the same Google account as Play Console.
2. Completed 2026-08-17: Play Console accepted the website association and now shows the website as verified.
3. Change the developer account from Personal to Organization:
   - create or select an organization Google payments profile;
   - provide the exact Shimizu Technology D-U-N-S record;
   - provide organization type, size, phone, and contact/developer details;
   - complete email/phone OTPs and any requested organization-document review;
   - link the verified payments profile to Play Console.
4. Wait at least 72 hours after the account-type transition before submitting a new app. Google recommends this to avoid redundant app rejections while account data propagates.
5. Completed 2026-08-17: created the dedicated Firebase project, registered `com.codeschoolofguam.connect`, committed only the public Android client config, and assigned a dedicated FCM V1 key in EAS. The private service-account JSON remains outside Git with owner-only local permissions.
6. Partially completed 2026-08-17: installed the Android SDK packages, created and booted a Play Store API 36 emulator, built and installed the debug app, reached the Clerk Google OAuth handoff, and verified the generated release manifest. Physical-device-only rows in [TEST_MATRIX.md](./TEST_MATRIX.md) remain open.
7. Completed 2026-08-17: generated the signed EAS production AAB at version code 3 from the 5/5-reviewed commit and confirmed package, version, target/min SDK, permissions, signature integrity, production runtime configuration, 16 KB compatibility, Firebase Messaging, and absence of the development client.
8. Create the Play app record under Shimizu Technology and complete the store listing, App content, Data safety, content rating, target audience, app access, ads, and account-deletion declarations.
9. Upload the AAB to Internal testing as a draft. Add only authorized internal testers and complete physical-device testing. An emulator is necessary but cannot validate push delivery, OEM behavior, real microphone routing, or Play-installed signing.
10. Move to Closed testing when the internal matrix is clean. If Google still applies the new-personal-account gate, maintain at least 12 opted-in testers continuously for 14 days before applying for production access.
11. Submit to production only after the organization conversion, 72-hour propagation window, production backend/web deployment, physical Android acceptance, and explicit owner approval.

## Release gates

- The web privacy policy, terms/community guidelines, and account-deletion page must be deployed at their stable production URLs before Play review.
- Production Rails must include the safety migration and API endpoints before the Android binary reaches reviewers.
- A reusable reviewer account must work without location restrictions, expiring OTPs, or a personal Google account. Store the credentials only in Play Console.
- UGC consent, message/user reporting, blocking, moderation queue, and deletion-request flows must be exercised against production.
- Data safety answers must be reconciled against the final AAB's SDKs and permissions, not copied blindly from this repository draft.
- `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO` must remain absent; occasional attachment selection uses the Android system picker.
- Production builds must not contain `SYSTEM_ALERT_WINDOW`, development menus, demo mode, or test-only activities.
- No student identity, message, grade, submission, private URL, or token may appear in store screenshots.

## Account conversion blockers

The organization website prerequisite is complete. Organization conversion now requires owner-supplied information that must not be guessed:

Play Console currently offers two existing Shimizu Technology payments profiles for the conversion, but both explicitly require a D-U-N-S number. No profile has been selected or changed.

- exact legal organization name and address matching Dun & Bradstreet;
- D-U-N-S number;
- organization phone number;
- organization type and employee-count range;
- verified private contact email/phone;
- verified public developer email/phone;
- any documents Google requests.

Google states that organization developer name, legal name/address, developer email, and developer phone may be displayed publicly. Review those fields deliberately before saving.

## Official references

- [Choose a developer account type](https://support.google.com/googleplay/android-developer/answer/13634885)
- [Update identity details and convert to an organization](https://support.google.com/googleplay/android-developer/answer/16260648)
- [Required organization information](https://support.google.com/googleplay/android-developer/answer/13628312)
- [Target API requirements](https://developer.android.com/google/play/requirements/target-sdk)
- [Testing requirements for new personal accounts](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Set up Play testing tracks](https://support.google.com/googleplay/android-developer/answer/9845334)
- [Prepare an app for review](https://support.google.com/googleplay/android-developer/answer/9859455)

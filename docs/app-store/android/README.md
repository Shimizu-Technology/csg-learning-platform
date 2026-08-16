# CSG Connect — Google Play Release Runbook

Last updated: 2026-08-17 (Pacific/Guam)

This directory is the source of truth for the first Google Play release of CSG Connect. It records the release state without storing passwords, private student data, signing keys, service-account JSON, or reviewer credentials.

## Current state

| Item | State |
| --- | --- |
| Application ID | `com.codeschoolofguam.connect` |
| Marketing version | `1.0.0` |
| Local Android version code | `2`; EAS production builds auto-increment remotely |
| Target SDK | API 36, confirmed in the prior production AAB and required for new submissions beginning 2026-08-31 |
| Minimum SDK | API 24 |
| Developer account | Existing account owned by `shimizutechnology@gmail.com`; currently Personal |
| Public developer name | Play Console currently shows `Shimizu Technology`; confirm the public listing has propagated before launch |
| Organization conversion | Blocked on Search Console verification of `https://shimizu-technology.com/`, then D-U-N-S-backed organization profile and verification |
| Play app record | Not created yet |
| Android push | App code is ready; Firebase project/Android registration and EAS FCM V1 credential remain |
| Internal release | Not uploaded yet |

Do not create a second Play developer account. Convert the existing account so the current account history and existing app remain together.

## Release sequence

1. Verify `shimizu-technology.com` in Google Search Console using the same Google account as Play Console.
2. Complete the pending website association in Play Console.
3. Change the developer account from Personal to Organization:
   - create or select an organization Google payments profile;
   - provide the exact Shimizu Technology D-U-N-S record;
   - provide organization type, size, phone, and contact/developer details;
   - complete email/phone OTPs and any requested organization-document review;
   - link the verified payments profile to Play Console.
4. Wait at least 72 hours after the account-type transition before submitting a new app. Google recommends this to avoid redundant app rejections while account data propagates.
5. Create a dedicated Firebase project for CSG Connect, register `com.codeschoolofguam.connect`, and configure Android FCM V1 credentials in EAS. Keep service-account JSON out of Git.
6. Install the Android SDK packages, create an API 36 emulator, generate a local development build, and complete [TEST_MATRIX.md](./TEST_MATRIX.md).
7. Generate a fresh production AAB from the reviewed commit. Confirm package, version code, target/min SDK, permissions, signing certificate, 16 KB page compatibility, and that no development client is present.
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

The account-type control is disabled until Play verifies the organization website. Search Console currently has no property for the domain, so domain ownership must be established first. Organization conversion then requires information that should not be guessed:

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

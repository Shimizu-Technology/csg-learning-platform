# Google Play Data Safety Worksheet

This is a release worksheet, not a final legal determination. Reconcile it against the final AAB, production configuration, vendor contracts, and Play Console's then-current definitions before submitting.

## High-level answers

| Question | Draft answer | Evidence/qualification |
| --- | --- | --- |
| Does the app collect or share required user-data types? | Yes, collects | Account, learning, communication, device/push, analytics, diagnostic, and optional media data are processed |
| Is data encrypted in transit? | Yes | Production app/API/provider traffic uses HTTPS/TLS; verify all final endpoints |
| Can users request deletion? | Yes | In-app request plus public web page; staff completes verified requests |
| Does the app contain ads? | No | No advertising SDK identified; re-scan final dependency graph |
| Is all collection optional? | No | Identity and core learning records are required for the invited educational service |

## Data-type inventory

| Play category | Examples in CSG Connect | Collected | User optional? | Primary purposes |
| --- | --- | --- | --- | --- |
| Personal info | Name, email, profile image, role, cohort, optional GitHub username | Yes | Mostly no; some profile fields optional | Account management, app functionality, security |
| User IDs | Clerk identity, internal user ID | Yes | No | Authentication, authorization, account management |
| Messages | Channel/direct messages, reactions, reports, moderation records | Yes | Message creation is optional | App functionality, safety, communications |
| Photos and videos | User-selected conversation attachments | When selected | Yes | App functionality |
| Files and docs | User-selected attachments and coursework artifacts/links | When submitted | Yes | App functionality, education |
| Audio | Foreground voice-draft recording sent for transcription | When deliberately used and server feature enabled | Yes | App functionality |
| App interactions | Screen/feature events, lesson and recording progress, notification interactions | Yes | Core records no; analytics depends on production configuration | App functionality, analytics |
| Other user-generated content | Submissions, help requests, feedback, reports | Yes | Some creation optional | App functionality, education, safety |
| App info and performance | Sanitized failures, version/device context, diagnostics | Yes | No when enabled | Analytics, fraud/security, diagnostics |
| Device or other IDs | Push token and installation/device identifiers used by notification providers | When notifications are enabled | Yes | App functionality, notifications |

Likely not collected: precise/approximate location, contacts, SMS/call logs, health data, calendar, web browsing history, advertising data, financial/payment-card data, and broad device photo/video libraries. Verify the final AAB and production feature flags before asserting these exclusions.

## Third-party processing review

The production system may send limited data to Clerk, Render, Neon, Netlify, AWS, Expo, Firebase/Google, Apple, PostHog, Resend, GitHub, and the approved voice-transcription provider. Determine whether each transfer is “shared” under Google's service-provider exceptions based on the actual contract, purpose, and provider behavior. Do not automatically mark all processors as either shared or not shared.

Specific checks before submission:

- verify PostHog autocapture and session replay remain disabled and list the exact typed events;
- verify development/demo analytics are disabled;
- verify microphone audio is created only after an intentional action, uploaded only for transcription, never posted as audio, and removed from local cache on completion/cancel/dismissal;
- verify push tokens are scoped to the signed-in user and removed on sign-out where supported;
- verify selected attachments use a system picker and the manifest lacks broad photo/video permissions;
- verify Android app-data backup remains disabled because server data can be restored after authentication and local caches/drafts may contain educational or communication data;
- verify account deletion requests are monitored and completed within the public process;
- verify every SDK disclosed here is present in the final bundle and remove stale vendors from the privacy policy.

## Account deletion evidence

- In app: **You → Privacy & account → Request account deletion**.
- Public URL: `https://learn.codeschoolofguam.com/account-deletion`.
- Request state is durable and visible in the admin Safety queue.
- Completion is a reviewed operational process because academic, safeguarding, security, and legal retention can require record-specific handling.
- Marking a request completed must occur only after the actual deletion/anonymization work and required-retention explanation are finished.

Official references:

- [Provide information for the Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
- [User data policy](https://support.google.com/googleplay/android-developer/answer/10144311)
- [Photo and video permissions policy](https://support.google.com/googleplay/android-developer/answer/15800983)

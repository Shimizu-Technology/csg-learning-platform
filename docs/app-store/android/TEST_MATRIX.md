# Android Release Test Matrix

Record device, Android version, build version code, tester, date, pass/fail, and issue link for every run. No production student data should appear in artifacts.

## Emulator gate

- [ ] Fresh install on an API 36 phone emulator
- [ ] Upgrade from the previous internal build without losing the signed-in session or local drafts
- [ ] Portrait, landscape, split-screen, keyboard-open, and largest supported font/display sizes
- [ ] Light and dark system appearance; adaptive and monochrome launcher icons
- [ ] Cold launch, background/foreground, process death, offline launch, and reconnection
- [ ] Google sign-in redirect and reusable email/password reviewer sign-in
- [ ] Student, instructor, admin, unauthorized, archived, and signed-out states
- [ ] Today, Learn, Messages, Updates, Recordings, You, and every deep link
- [ ] Prework/live-class lessons, YouTube playback, secure recording playback, resume, PiP, and full screen
- [ ] Submission create/update, progress, grading/feedback, help request, and web handoffs
- [ ] Channel/DM/thread send, edit, delete, reaction, mention, attachment, search, pin, mute, unread, and failed-send recovery
- [ ] Mandatory community-terms gate cannot be skipped before UGC creation
- [ ] Report message, report user, block user, blocked-content hiding, DM prevention, notification suppression, unblock
- [ ] Privacy/terms/deletion links and durable deletion request
- [ ] Sign-out clears user-scoped cache, push registration, drafts, and sensitive UI
- [ ] No development menu, demo data, test activity, debug overlay, or `SYSTEM_ALERT_WINDOW`

## Physical Android gate

A borrowed test phone, dedicated QA phone, or reputable device lab is required even though the owner does not currently have an Android device.

- [ ] Install through Google Play Internal testing, not only `adb`
- [ ] Verify Play App Signing build identity and upgrade path
- [ ] Push notification registration and foreground/background/terminated delivery
- [ ] Notification deep links to messages, announcements, feedback, and recordings
- [ ] Denied/allowed microphone flow, voice draft, cancellation, retry, audio interruption, Bluetooth/wired routing
- [ ] System photo/file picker with allowed and denied access
- [ ] Video playback/PiP/background behavior on a real OEM device
- [ ] Low-memory/process-recreation, slow Guam mobile network, offline recovery, and battery restrictions
- [ ] Accessibility with TalkBack, large text, color/contrast, labels, and 44px-equivalent touch targets
- [ ] At least one current Google Pixel profile and one non-Pixel/OEM profile through a physical device or Firebase Test Lab

## Bundle and policy gate

- [ ] `com.codeschoolofguam.connect`, `1.0.0`, unique version code, target SDK 36, min SDK 24
- [ ] AAB signing certificate recorded; Play App Signing enrollment and upload certificate recorded securely
- [ ] 16 KB page-size compatibility check passes
- [ ] Manifest permission diff reviewed and matches Data safety/permissions declarations
- [ ] `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `MANAGE_EXTERNAL_STORAGE`, and `SYSTEM_ALERT_WINDOW` absent from the merged release manifest
- [ ] Release uses production Clerk, API, EAS project, Firebase app, FCM V1 credential, and analytics configuration
- [ ] Release has demo mode disabled and contains no secrets
- [ ] `npm run check`, Expo Doctor, Android export/prebuild/build, Rails CI, web checks, and security scans pass on the reviewed commit
- [ ] Privacy, terms, and deletion URLs return 200 without authentication
- [ ] Reviewer credentials work from a fresh device without OTP
- [ ] Store screenshots match the submitted build and contain fictional data only

## Staged rollout

1. Internal test: owner/instructor plus technical QA; resolve every release blocker.
2. Closed test: representative authorized students and staff; collect structured feedback and crash/ANR evidence.
3. Production: begin with a conservative staged rollout, monitor Play vitals, auth, API errors, push delivery, reports, and support requests, then expand deliberately.

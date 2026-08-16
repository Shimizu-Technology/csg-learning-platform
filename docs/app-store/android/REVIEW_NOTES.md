# Google Play Reviewer Access and Notes

Never commit reviewer credentials here. Enter them only in Play Console's App access form.

## Reviewer access prerequisite

Google requires reusable access that works regardless of reviewer location and does not depend on an expiring OTP or personal social-login approval. Before submission:

1. Create a dedicated Clerk review user with email/password access and no 2FA, magic-link-only, or Google-account dependency.
2. Create the matching invited Rails user and active test enrollment.
3. Seed fictional but representative lessons, submissions, recordings, announcements, messages, and feedback.
4. Keep the account active for the full review window and future update reviews.
5. Store its email/password only in Play Console. Rotate it after review only after updating Play access instructions.

## Draft reviewer instructions

CSG Connect is an invitation-only learning platform for Code School of Guam. Use the reusable review email and password supplied in the Play Console fields. No one-time code, phone verification, subscription, payment, or location restriction is required.

After signing in:

1. Accept the Terms and Community Guidelines gate. This is required before creating messages or uploads.
2. Use **Today** to view current tasks and announcements.
3. Use **Learn** to open lessons, resources, submissions, feedback, and recordings.
4. Use **Messages** to open a channel or direct conversation. The message action menu contains clearly labeled **Report** and **Block user** actions.
5. Use **You → Privacy & account** to open the privacy policy and terms, manage blocked users, and submit an account-deletion request.

Staff-only content management is available in the web administration interface and is not required to evaluate the student Android experience. If Google requests staff access, add a second reusable reviewer instruction set with a dedicated fictional staff account; do not disclose a real administrator's Google credentials.

## Review notes to disclose

- The app has no ads, paid download, or in-app purchase in this release.
- The app is intended only for invited Code School of Guam learners and staff.
- User-generated content is limited to the enrolled community and is covered by mandatory terms, reporting, blocking, and staff moderation.
- Microphone access is optional and appears only when the user intentionally starts voice dictation for an editable text draft. Audio is not posted as a voice message.
- Photo/file access is user-initiated through a system picker; the app does not need broad media-library permissions.
- Some secure course recordings and role-scoped features require the supplied authorized account.

Official reference: [Requirements for providing sign-in details for review](https://support.google.com/googleplay/android-developer/answer/15748846).


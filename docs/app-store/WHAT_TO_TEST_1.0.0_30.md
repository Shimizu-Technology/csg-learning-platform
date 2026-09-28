# CSG Connect 1.0.0 (30): cohort navigation and alumni GitHub access

Confirm TestFlight shows **1.0.0 (30)** before testing the native navigation change. Use an authorized staff account for the alumni roster.

1. Open Today, then the cohort switcher and a cohort home. Follow links to the roster, messages, grading, schedule, resources, and student access. Each screen should have a back arrow without the literal text “(tabs).” The back control should announce “Back” with VoiceOver and return to the expected screen. Check a few nested screens from Learn and Messages too.
2. In the **CSG Alumni** cohort, open the student access roster. Confirm it names `Code-School-of-Guam-Alumni` and shows membership or invitation states instead of saying no GitHub organization is configured. Resource links should still open independently.
3. On desktop web, open the CSG Alumni cohort settings as an admin. Confirm the GitHub organization field contains `Code-School-of-Guam-Alumni`. Avoid changing the production setting during this check.

The alumni organization setting is a live backend change, so its roster correction can also appear in build 29 after the API deployment. Report the device, iOS version, account role, screen, and exact steps for any remaining issue. Complete the broader [physical TestFlight acceptance checklist](README.md#physical-testflight-acceptance) before public App Review.

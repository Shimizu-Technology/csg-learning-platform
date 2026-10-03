# CSG Connect 1.0.0 (32): global cohort scope

Confirm TestFlight shows **1.0.0 (32)** before testing. Use an authorized account with access to at least two cohorts. Keep private student information out of defect reports.

1. Update from build 31 and launch the app. Confirm the previously selected cohort is still selected and the app reaches its normal signed-in screen without a crash or navigation loop.
2. Open **Messages** and select a different cohort workspace. Move through **Today**, **Learn**, **Updates**, **Recordings**, and **You**. Confirm every cohort-scoped screen follows the cohort selected in Messages and does not fall back to the prior alumni or bootcamp cohort.
3. Select another cohort from a non-message screen, then return to **Messages**. Confirm Messages automatically opens that cohort's workspace, with no conversation or channel from the previous cohort left active.
4. Repeat both directions several times between a current bootcamp, a focused course, and an alumni cohort where available. Confirm the cohort label, content, empty states, unread state, and navigation destinations all agree after each switch.
5. In **Messages**, explicitly open a community workspace. Confirm this changes only the message workspace and does not change the globally selected cohort elsewhere. Then select a different cohort outside Messages and confirm Messages leaves the community override for the matching cohort workspace.
6. Force-quit and relaunch the app. Confirm the last globally selected cohort is restored and Messages resolves to its matching cohort workspace. Sign out and sign back in, then confirm one user's saved selection does not leak into another account.
7. Repeat the core Messages-to-other-tabs and other-tabs-to-Messages checks on the production web app. On desktop, collapse the sidebar and confirm the icon-only cohort switcher stays inside the rail, opens from the full control, supports keyboard selection, and updates the same global cohort scope.

Report the device model, iOS version, account role, starting cohort, selected cohort, exact steps, and whether the issue also appears on the web app. This is an internal TestFlight pass; public App Review remains separate and intentionally deferred.

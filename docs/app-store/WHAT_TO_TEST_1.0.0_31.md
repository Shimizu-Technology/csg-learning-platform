# CSG Connect 1.0.0 (31): SDK 57 dependency baseline

Confirm TestFlight shows **1.0.0 (31)** before testing. Use authorized accounts and avoid private student information in defect reports.

1. Launch the app after updating from build 30. Sign in, sign out, and sign in again. Confirm the app does not crash, loop at launch, or lose the selected cohort unexpectedly.
2. Switch between a bootcamp and a focused-course cohort. Open **Today**, **Learn**, **Messages**, **Updates**, **Recordings**, and **You** in each available workspace. Confirm content stays scoped to the selected cohort and navigation returns to the expected screen.
3. Open a lesson, play an available recording, move the app between foreground and background, and return. Confirm playback, progress, and the lesson state remain usable.
4. Send and receive a test message, attach a small file where authorized, and open a notification. Confirm the conversation opens once, remains responsive, and the notification reaches the correct screen.
5. Open an upcoming class or private-meeting entry and confirm its time and meeting link display correctly. Check the same entry on the web app.
6. As staff, spot-check the curriculum library, a student submission, grading, a help request, and the alumni access roster. Confirm the SDK dependency update did not change these established flows.
7. On the web app, use a dedicated test cohort and newly created test enrollments to verify the guided-course cutoffs. First set the cohort's lesson-access date in the past **before** enrolling a learner; confirm that learner cannot open lessons. Then use a separate new enrollment with a future lesson-access date and a past instructor-support date; confirm lessons remain available while instructor messaging, help requests, and private-meeting booking are blocked. Restore or remove the test cohort, dates, and enrollments after the checks. These controls came from PR #160 and are not a new native build 31 screen.

Report the device model, iOS version, account role, cohort, exact steps, and whether the issue also appears on the web app. This internal TestFlight pass remains separate from public App Review and from the full Python pilot learner rehearsal.

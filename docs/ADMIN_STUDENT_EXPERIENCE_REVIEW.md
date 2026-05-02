# Admin and Student Experience Review

This document captures the next set of product and reliability improvements identified during the application review. It is intentionally written before implementation so the work can be split into safe, focused PRs.

## Goals

- Make the student app feel reliable and comfortable on mobile.
- Make admin cohort management more usable for day-to-day operations.
- Keep student-facing content consistent across YouTube links and uploaded recordings.
- Add visibility for staff without creating privacy or account-control risks.
- Create a public-facing entry point that explains the platform before login.

## Recommended Build Order

### Phase 1: Daily-use polish and low-risk fixes

These items affect everyday use and can be shipped without major auth or data-model risk.

1. Fix mobile message overflow.
   - Problem: On mobile, the messages view can become wider than the viewport, causing the right side of the conversation area to be cut off.
   - Likely areas: message rows, long text, inline code, code blocks, attachment cards, composer toolbar, and conversation/action controls.
   - Direction: Audit mobile layout with real viewport testing and enforce `min-w-0`, `max-w-full`, safe wrapping, horizontal scrolling only where intentional, and attachment/card constraints.

2. Add admin resource view/edit modes.
   - Problem: Admins can edit class resources, but the admin side is not optimized for simply using or opening those resources.
   - Direction: Add a clean view mode with clickable resource cards, category badges, descriptions, and open/copy actions. Keep edit mode separate for adding/removing/updating links.
   - Categories should remain simple at first: general, meeting, GitHub, communication, documentation, and hotkeys/shortcuts.

3. Add admin recording preview.
   - Problem: Uploaded recordings can be managed, but admins do not have a convenient way to preview them in the admin UI.
   - Direction: Add preview/play actions for uploaded recordings using the existing stream URL flow and video player. External video links should open or preview where embeddable.

4. Improve student Materials with collapsible modules.
   - Problem: The Materials page can become long and dense as cohorts grow.
   - Direction: Let students expand/collapse modules, persist their preference locally, and default active/incomplete modules open. Include expand all/collapse all controls.

### Phase 2: Public entry point and content consistency

These items are useful but touch routing or content shape more broadly.

1. Add a public homepage.
   - Problem: The root route currently functions as the authenticated dashboard.
   - Direction: Add a public homepage that explains Code School of Guam’s learning platform and links to sign in/sign up. Signed-in users should have a clear path back to the app dashboard.
   - Routing decision: Prefer moving the authenticated dashboard to `/dashboard` while keeping redirects/backward compatibility for existing users.

2. Unify recordings model and UI more fully.
   - Current state: Student recordings already combine uploaded and YouTube/external recordings into one student experience, with source distinctions.
   - Remaining work: Make admin management feel equally unified, and consider normalizing the API response over time so clients do not have to merge separate uploaded and legacy arrays.
   - Direction: Show one admin recording list with source badges such as Uploaded, YouTube, and External.

3. Add a hotkeys/shortcuts resource section.
   - Direction: Start with a resource category named `hotkeys` or `shortcuts`, then render that category as a special section on student Resources.
   - Avoid creating a separate daily-hotkey model until there is a clear need for scheduling, rotation, or history.

### Phase 3: Staff visibility and communication features

These features are valuable but need more careful privacy, performance, and product decisions.

1. Add read receipts.
   - Current state: The backend already tracks read state for unread counts in channels and direct messages.
   - Gap: The API does not expose per-message read receipt summaries.
   - Direction: Start with lightweight receipts on messages sent by the current user, especially in direct messages and small cohorts. Avoid noisy receipts on every message in large channels.
   - Suggested UI: “Seen by Alex” or “Seen by 4” with a tooltip/popover for names.

2. Show last login and recent activity more clearly.
   - Current state: `last_sign_in_at` exists and is already returned in several admin/student progress payloads.
   - Caveat: Because auth sync updates it, the label should be chosen carefully. It may be closer to “Last signed in” or “Last account sync” depending on exact backend behavior.
   - Direction: Display it in admin student lists/details where helpful, alongside existing learning activity data.

3. Add online/recently-online presence.
   - Current state: There is no true user presence system.
   - Direction: Add a lightweight `last_seen_at` heartbeat first, then show “Online now” or “Active recently” based on a short threshold.
   - Future direction: Real-time ActionCable presence can come later if live status needs to be highly accurate.

4. Add read-only student view for staff.
   - Important decision: This must be read-only. It should not be true account impersonation.
   - Goal: Let admins/instructors see what a selected student sees without acting as that student.
   - Direction: Build a staff-only “View as student” mode with a persistent banner and a clear “Back to admin view” button.
   - Safety rules:
     - Do not mutate student progress, submissions, profile, message state, or watch progress while in preview mode.
     - Do not replace the Clerk session or backend `current_user`.
     - Server endpoints must verify the requester is staff before returning preview data for a student.
     - Prefer dedicated preview endpoints or explicit `preview_user_id` support over broad client-side impersonation.
     - Disable or hide actions that would submit work, mark content complete, send messages, edit profile data, or update watch progress.

## Feature Notes

### Mobile Messages

This should be treated as a bug fix before adding more messaging features. A communication tool that cuts off on mobile will feel unreliable even if the backend is working correctly.

Acceptance criteria:

- Messages page never creates page-level horizontal overflow on mobile.
- Long URLs, long words, inline code, and code blocks do not push the conversation wider than the viewport.
- Attachments fit within the message column.
- Composer toolbar scrolls horizontally only inside its own toolbar area.
- Thread and conversation panes remain usable on small screens.

### Admin Resources

The admin resource experience should support both “manage this list” and “use this list now.”

Recommended behavior:

- View mode: grouped resource cards, clickable links, copy/open actions.
- Edit mode: existing add/edit/remove form controls.
- Hotkeys/shortcuts: supported as a category first.

### Recordings

Students should not need to understand where a recording is hosted. They should see one recordings list with source labels. Admins should have the same mental model.

Recommended behavior:

- One list for uploaded and external recordings.
- Source badges: Uploaded, YouTube, External.
- Uploaded recordings preview in-app.
- YouTube recordings embed when possible.
- Non-embeddable external links open in a new tab with clear labeling.

### Public Homepage

The homepage should be clear, useful, and public. It should explain what the platform is, who it is for, and where enrolled students or staff should sign in.

Recommended behavior:

- Public `/` route.
- Authenticated app dashboard at `/dashboard`.
- Clear sign-in and sign-up actions.
- Signed-in users can go directly to their dashboard/admin area.

### Read Receipts

Read receipts should add confidence without turning messages into visual clutter.

Recommended first version:

- Direct messages: show seen state for latest sent messages.
- Channels: show aggregate seen count for staff or small cohorts only.
- Do not show read receipts for deleted messages.
- Avoid expensive per-message queries by preloading read states for the visible message window.

### Presence

Presence should be approximate at first. “Online now” is only trustworthy with a heartbeat or live connection tracking.

Recommended first version:

- Add `users.last_seen_at`.
- Update via lightweight heartbeat or authenticated app activity.
- Show online if seen within a short threshold, such as 2-5 minutes.
- Show recently active if seen within a longer threshold.

## Open Product Decisions

- Should public sign-up be open, invite-only, or invite-first with a friendly explanation?
- Should students who are already signed in land on the public homepage or automatically redirect to `/dashboard`?
- Should hotkeys be global, cohort-specific, or curriculum/module-specific?
- Should staff be able to preview student view only from a student detail page, or from cohort lists too?
- For read-only student view, should previews include messages, or only curriculum/materials/recordings/resources?

## Implementation Principles

- Keep PRs focused and reviewable.
- Prefer read-only preview over true impersonation.
- Avoid broad auth/session changes unless the feature requires them.
- Preserve existing student progress and watch progress semantics.
- Test mobile UI with real viewport screenshots before shipping message layout changes.
- Treat admin convenience features as operational tools, not marketing pages.

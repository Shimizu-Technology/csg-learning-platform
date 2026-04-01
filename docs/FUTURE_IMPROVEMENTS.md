# CSG Learning Platform - Future Improvements

## GitHub Organization Onboarding (Planned)

### Context

In `csg-prework-grader`, editing a student's GitHub username currently attempts to send a GitHub organization invitation automatically. That behavior is acceptable for now, but it is not ideal for long-term operations because student profile updates and org-invite operations are coupled.

For `csg-learning-platform`, GitHub org access should be implemented as a dedicated workflow with clear admin controls, observability, and failure handling.

### Goals

- Keep student profile edits fast and reliable.
- Make GitHub invitation actions explicit and auditable.
- Support both manual and automated onboarding paths.
- Avoid blocking admin flows when GitHub API fails.

### Product Behavior (Target)

1. Admin updates student profile (including `github_username`) without triggering GitHub API calls.
2. Admin can click an explicit action: `Send GitHub Invite`.
3. System shows invite state:
   - `not_sent`
   - `pending`
   - `accepted`
   - `failed`
4. Failures show actionable details and a `Retry` action.
5. Optional bulk action from admin list: `Invite selected students`.

### Data Model Additions (Proposed)

Add a table such as `github_memberships`:

- `user_id` (FK)
- `cohort_id` (FK, optional depending on org strategy)
- `organization_name`
- `github_username`
- `state` (`not_sent`, `pending`, `accepted`, `failed`)
- `last_error` (text)
- `invited_at` (datetime)
- `accepted_at` (datetime)
- `last_synced_at` (datetime)
- timestamps

### Backend Plan

- Add service object(s):
  - `Github::OrgInviter`
  - `Github::MembershipSync`
- Add endpoints:
  - `POST /api/v1/admin/github_memberships/:id/invite`
  - `POST /api/v1/admin/github_memberships/:id/retry`
  - `POST /api/v1/admin/github_memberships/sync`
- Run invitations/sync via background jobs (non-blocking).
- Keep token usage server-side only (`GITHUB_ORGANIZATION_ADMIN_TOKEN`).
- Add idempotency protections (do not send duplicate pending invites).

### Frontend/Admin UX Plan

- Student detail page:
  - editable `github_username`
  - invite status badge
  - `Send Invite` / `Retry Invite` button
- Student list:
  - filter by invite state
  - bulk invite action
- Event log/timeline entry for each invite attempt.

### Safety and Ops Requirements

- Role gate to staff/admin only.
- Rate-limit invite actions.
- Structured logs for each GitHub API request outcome.
- Clear alerts when token is missing/invalid.
- Never fail profile update due to GitHub API failure.

### Testing Requirements

- Unit tests for invite/sync services.
- Request tests for permission checks and endpoint behavior.
- Job tests for retry logic.
- UI tests for state transitions (`pending -> accepted`, `failed -> retry`).

### Suggested Delivery Phases

1. **Phase 1:** Manual-first invite button + status tracking.
2. **Phase 2:** Retry + sync endpoint + background jobs.
3. **Phase 3:** Bulk invite + dashboard metrics.
4. **Phase 4:** Optional automation rules (feature-flagged).

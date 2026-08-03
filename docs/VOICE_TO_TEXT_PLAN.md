# Voice-to-Text Messaging Plan

**Status:** Phase 1 message flow and Phase 2 learning/instructor reuse complete; TestFlight stabilization in progress
**Last updated:** 2026-08-03
**Owner:** Product and engineering

## 1. Decision

Add voice-to-text as a fast way for students and instructors to compose written messages. The first release records a short voice clip, transcribes it, applies conservative readability cleanup, and places the result into the normal editable composer.

The app must never send a voice-generated message automatically. The person reviews, edits, and presses **Send** exactly as they do for typed text.

This is text composition, not a voice-note or live voice-chat feature. Raw audio is temporary processing data, not a new message type.

## 2. Why this belongs in CSG Connect

Code School communication is time-sensitive and often happens away from a desk: a student hits a blocker, an instructor sends a check-in, or staff gives a concise next step. Voice input lowers the effort required to capture that context while preserving a searchable, accessible written conversation.

It directly supports the platform principles:

- make asking for help easy;
- shorten the feedback loop;
- support students and instructors on mobile;
- preserve an editable, auditable text record;
- improve accessibility without replacing existing keyboard and assistive-technology input.

The Code School operating notes already emphasize early blocker messages, specific check-ins, immediate feedback, and surfacing questions before students stay stuck. Relevant internal context includes `Brain-Dump/work/code-school/csg-live-class-operator-pack.md`, `Brain-Dump/work/code-school/csg-cohort3-week1-operator-checklist.md`, and `Brain-Dump/code-school/actualize-review.md`.

## 3. Product experience

### Primary flow

1. The person taps a microphone control beside the message composer.
2. On first use, the app explains why microphone access is needed and then requests the operating-system permission.
3. The composer changes to an unmistakable recording state with elapsed time, audio activity, **Cancel**, and **Stop**.
4. After **Stop**, the app shows a short **Transcribing…** state.
5. The resulting text appears in the existing composer as a draft.
6. Light cleanup may add punctuation, capitalization, paragraph breaks, or a list when the speaker clearly enumerated items.
7. The person can edit the draft, restore the original transcript, record again, or send it.

If text already exists in the composer, the transcript is inserted at the cursor with deliberate whitespace instead of replacing the draft.

### Formatting contract

“Format it nicely” must mean improving readability without changing meaning.

Allowed transformations:

- sentence casing and punctuation;
- removing obvious filler sounds and repeated false starts;
- paragraph breaks between distinct thoughts;
- Markdown bullets when the speaker explicitly lists multiple items;
- recognized spoken controls such as “new paragraph” or “bullet point”;
- spelling from a small approved CSG technical vocabulary such as Ruby, Rails, React, GitHub, PostgreSQL, Vite, Tailwind, Clerk, and assignment names.

Disallowed transformations:

- adding facts, advice, answers, or emotional tone;
- rewriting a student question into something more certain than the student said;
- changing names, URLs, commands, error messages, numbers, dates, or grades;
- inventing Markdown emphasis or code fences without a clear spoken instruction;
- silently “correcting” code or terminal commands;
- sending the result without review.

Keep the raw transcript in memory until the draft is sent, discarded, or the composer closes so **Restore original** is possible. Low-confidence technical language should remain close to verbatim and be easy to edit.

### Failure and interruption states

- **Permission denied:** keep typing available and offer a clear route to device settings when the OS no longer allows another prompt.
- **Offline:** explain that transcription needs a connection; do not retain a hidden audio queue. System keyboard dictation remains an independent option when the device supports it.
- **Phone call, route change, or app backgrounding:** stop safely, preserve the typed draft, and let the person retry.
- **Transcription failure or timeout:** retain the temporary recording only long enough for an explicit retry during that composer session, then delete it.
- **Very quiet or empty recording:** do not create an empty draft; explain what happened.
- **Existing audio playback:** pause or manage the audio session predictably and restore prior playback behavior when recording ends.

## 4. Initial scope and boundaries

### Version 1

- native direct-message and channel composers;
- recordings capped at five minutes as a safety boundary, with the limit shown only when 30 seconds remain;
- authenticated server transcription;
- conservative cleanup into an editable draft;
- permission-denied, offline, cancellation, interruption, timeout, and retry states;
- analytics that record feature state, duration bucket, and outcome but never audio or transcript content;
- iPhone and Android physical-device acceptance.

### Version 1.1

- native thread replies;
- contextual **I’m stuck** descriptions after help requests exist;
- instructor grading feedback where the same review-before-save rule applies;
- a shared composer hook/component so behavior does not drift between surfaces.

### Version 2, only after usage validates the need

- web message composition using browser recording APIs;
- announcements and longer instructor feedback;
- an expanded course vocabulary and optional explicit commands for lists, paragraphs, and code blocks;
- language selection or multilingual transcription if actual cohort demand exists;
- streaming partial text only if measured latency makes stop-then-transcribe feel meaningfully slow.

### Not in scope

- live voice rooms or calls;
- persistent voice messages;
- background recording;
- always-listening activation;
- voice cloning or synthetic instructor voices;
- an AI tutor response triggered by dictated text;
- automatically generated or repaired code;
- retaining audio for analytics, model training, or staff review.

## 5. Recommended technical shape

### Mobile

At planning time, the Expo app had no recording library and its image-picker configuration explicitly set `microphonePermission` to `false`. The implemented voice input adds `expo-audio` and an explicit microphone usage description, so it requires a new native build rather than an over-the-air JavaScript-only release.

Recommended implementation:

- install the Expo SDK 57-compatible `expo-audio` package;
- add its config plugin with a plain-language microphone permission string;
- keep background recording disabled;
- request permission only when the person intentionally taps the microphone;
- record a speech-appropriate compressed format to the app cache;
- delete the local file after success, cancellation, expiry, or terminal failure;
- centralize state in a reusable `VoiceDraftController` or hook rather than embedding recording logic in each screen.

The operating system’s keyboard dictation should continue to work as a zero-custom-UI fallback, but it does not replace the CSG flow because the app cannot consistently provide the same cleanup, course vocabulary, error handling, or product measurement around it.

### API

Add an authenticated endpoint such as:

```text
POST /api/v1/transcriptions
Content-Type: multipart/form-data

audio: <file>
surface: message | thread | help_request | grading_feedback
cleanup: conservative
```

Return only the data needed to review the draft:

```json
{
  "raw_text": "...",
  "suggested_text": "...",
  "duration_seconds": 18,
  "warnings": []
}
```

The Rails API should:

- verify Clerk authentication and role/surface authorization;
- validate content type, file signature, size, and duration;
- rate-limit by user and reject recordings above the duration limit;
- call the transcription provider from the server so credentials never ship in the app;
- apply a strict, meaning-preserving cleanup contract;
- avoid logging multipart bodies, audio, raw transcripts, or suggested text;
- delete server-side temporary audio immediately after processing;
- expose provider latency/error metrics without exposing message content;
- use an adapter so the provider can change without rewriting clients.

A dedicated database model is not required for the first version. The transcript becomes durable only if the person sends it through an existing message or saves it as feedback. If an audit record is needed, store content-free metadata such as user, surface, provider, duration bucket, outcome, and timestamp.

### Provider choice

The Phase 1 implementation uses OpenAI server-side through a replaceable Rails adapter:

- `gpt-transcribe` for the faithful transcript and a small approved CSG vocabulary hint;
- `gpt-5.6-luna` with reasoning set to `none`, strict structured output, and `store: false` for conservative cleanup;
- a raw-transcript fallback when cleanup is unavailable, while transcription failures remain explicit errors;
- M4A input only for the first native release, with signature and MP4 movie-duration verification on the server.

This matches the workload roles: transcription uses the current dedicated speech model, while the short, high-volume formatting task uses the efficient GPT-5.6 tier. Models remain configurable through server environment variables so clients do not depend on a permanent model choice.

OpenAI states that API data is not used for model training unless the customer opts in, but default abuse-monitoring logs may retain customer content for up to 30 days. CSG must disclose temporary third-party processing in its privacy policy and review the production project's data controls before setting `VOICE_TRANSCRIPTION_ENABLED=true`. The feature fails closed until that explicit flag is enabled. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) and [audio transcription documentation](https://developers.openai.com/api/docs/guides/speech-to-text).

Do not build realtime streaming first. A short recorded request followed by transcription is simpler to secure, test, retry, and explain. Add streaming only if measured end-to-end latency fails the acceptance target.

## 6. Privacy, safety, and accessibility

- Explain microphone use before the OS prompt and record only after explicit action.
- Display a persistent visual recording state and elapsed time; never record invisibly.
- Do not request background-recording permission.
- Define the transcription provider and temporary processing in the privacy policy before release.
- Confirm whether provider data controls meet CSG requirements before production use.
- Never include nearby message bodies, private feedback, or student code as hidden transcription context.
- Use a small approved vocabulary list rather than sending conversation history to improve technical terms.
- Give the microphone, Cancel, Stop, Retry, Restore original, and Send controls accessible names and at least 44-point touch targets.
- Announce recording and transcription state changes to VoiceOver/TalkBack without repeatedly interrupting speech.
- Do not rely on waveform color alone; pair it with text, time, and control state.
- Keep typing, paste, keyboard dictation, and assistive switch/voice-control paths fully available.

## 7. Acceptance criteria

### Functional

- A person can record, cancel, stop, transcribe, edit, restore the original, and send.
- Existing typed text is never lost when voice input starts, fails, is interrupted, or is cancelled.
- A sent message is ordinary sanitized message text and renders identically on web and native.
- Permission is requested in context and denial never blocks typed messaging.
- Audio is not left in app documents, server storage, request logs, analytics, or crash reports.
- Two rapid taps, navigation during transcription, and duplicate responses cannot insert the same text twice.
- The five-minute safety limit is enforced on both client and server.

### Quality

- Test common CSG vocabulary, Guam names, code-school terminology, noisy rooms, Bluetooth headsets, and natural pauses.
- Validate exact preservation of URLs, numbers, dates, error messages, and technical terms when spoken clearly.
- The cleanup result must not introduce facts absent from the raw transcript.
- Set the latency target after the provider spike and real Guam network measurements; do not invent one beforehand.
- Verify on physical iPhone and Android devices, not only simulators.

### Accessibility and platform behavior

- VoiceOver/TalkBack can identify and operate every recording state.
- Dynamic Type does not hide Cancel, Stop, or review controls.
- Recording handles calls, alarms, audio-route changes, app backgrounding, and screen locking safely.
- Existing lesson video and recording playback returns to a predictable state afterward.

## 8. Measurement

Add content-free events:

| Event | Safe properties |
| --- | --- |
| `voice_draft_started` | surface, platform, permission_state |
| `voice_draft_recorded` | surface, duration_bucket |
| `voice_draft_transcribed` | surface, latency_bucket, outcome |
| `voice_draft_inserted` | surface, raw_or_cleaned |
| `voice_draft_restored` | surface |
| `voice_draft_sent` | surface, edit_distance_bucket |
| `voice_draft_discarded` | surface, stage |

Do not capture audio, transcripts, draft text, message text, filenames, or provider prompts.

Evaluate after four teaching weeks:

- adoption by students and staff;
- transcription success and retry rate;
- median latency by platform/network bucket;
- share of voice drafts sent versus discarded;
- how often users restore or substantially edit the result;
- help-request and instructor-response time for people who use voice input;
- support complaints, permission confusion, and accessibility defects.

High discard, restore, or heavy-edit rates are quality signals—not reasons to hide them.

## 9. Delivery sequence

### Voice A — Foundation and spike (2–4 engineering days)

- test providers with representative CSG vocabulary and Guam network conditions;
- confirm retention/data-control terms;
- measure accuracy, latency, and estimated cost;
- finalize permission copy, duration, formats, and the cleanup contract;
- prototype audio-session interaction with existing video playback.

**Implementation status:** architecture, retention review, format/duration contract, provider adapter, and permission copy are implemented. Real Guam latency, representative vocabulary accuracy, and physical iPhone/Android audio-session acceptance remain release gates rather than claims made from simulator tests.

**Gate:** the provider/architecture passes privacy, accuracy, Guam-network, and physical-device feasibility review.

### Voice B — Native message draft (1–2 weeks)

- add permission and recording infrastructure;
- add the authenticated API endpoint and provider adapter;
- ship the record → transcribe → review → send flow in channel and direct messages;
- add deletion guarantees, analytics, unit/integration tests, and device tests.

**Implementation status:** complete in code for direct messages and channels. The managed iOS project compiles, installs, and launches with the generated microphone usage description; iOS and Android production JavaScript exports also pass. Production enablement still requires the privacy/data-control decision and the physical iPhone/Android acceptance below.

**Gate:** no automatic send, no draft loss, no retained audio, and the physical-device acceptance suite passes.

### Voice C — Learning and instructor surfaces (about 1 week)

- reuse the flow in threads, contextual help requests, and concise grading feedback;
- add approved technical/course vocabulary;
- evaluate whether cleanup helps or merely creates editing work.

**Gate:** student and instructor surfaces use one shared implementation and role authorization remains correct.

**Implementation status:** complete in code. The shared controller now accepts an explicit allowlisted surface and is reused for thread replies, contextual student questions, staff help responses, and concise grading feedback. Every flow inserts editable text at the current selection, retains raw-transcript restoration, and requires the existing Send, Resolve, or Grade action before anything becomes durable. Production enablement remains blocked on the same privacy/data-control and physical-device acceptance gates as Voice B.

### Voice D — Web and advanced behavior (only if validated)

- add web recording parity;
- evaluate multilingual support and streaming partial transcripts;
- expand to announcements or longer feedback only when measured demand justifies it.

**Gate:** the four-week review shows meaningful use, acceptable accuracy, and no privacy or accessibility regression.

## 10. Relationship to the product roadmap

Voice A starts after the Phase 0 code/readability release gate. Voice B belongs in Phase 1 alongside contextual help and measurement because it makes asking and responding easier while also establishing privacy-safe product events. Voice C aligns with Phase 2 feedback work. Voice D is optional later work, not a prerequisite for mastery, recovery, or accessible recordings.

This ordering keeps the immediate message-rendering defect ahead of a new composer capability and gives voice input a reliable, readable surface to land on.

## 11. Official references

- [Expo Audio recording, permissions, formats, and config plugin](https://docs.expo.dev/versions/latest/sdk/audio/)
- [Apple: asking permission to use speech recognition](https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition)
- [Apple: transcribing speech to text](https://developer.apple.com/tutorials/app-dev-training/transcribing-speech-to-text/)
- [OpenAI Audio API transcription reference](https://platform.openai.com/docs/api-reference/audio/createTranscription)
- [OpenAI API data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)

Re-check provider capabilities, pricing, retention, and platform permission requirements during Voice A because they can change.

## 12. TestFlight build 10 incident and stabilization decision

Physical testing on 2026-08-03 exposed two independent issues:

1. The failed voice request was reproducible in the production API log. `POST /api/v1/transcriptions` returned `503` in 311 ms because `VOICE_TRANSCRIPTION_ENABLED` was not enabled. The Render service also had no server-side OpenAI key, so toggling the flag alone could not have made the feature operational.
2. The iOS crash dialog did not have a captured stack trace. Code review identified a native lifecycle hazard: every composer owned an Expo recorder, while route cleanup could start `stop()`, delete its file, reset the audio session, and allow the native shared object to release concurrently. Navigation, backgrounding, or rapid controls could therefore overlap recorder shutdown.

The stabilization release makes the following decisions:

- one app-lifetime recorder is shared across composers and claimed by only one active voice draft;
- recorder shutdown is serialized before the audio session is reset, ownership is released, or a temporary file is deleted;
- permission startup, cancellation, app backgrounding, route teardown, and transcription aborts are idempotent;
- failed transcription audio remains available for explicit **Retry transcription**, **Record again**, or **Dismiss** during the current composer session;
- the UI uses a live activity waveform, elapsed time, larger circular controls, a clearer processing state, and a five-minute safety cap instead of displaying a persistent 1:30 countdown;
- mobile/API timeouts and upload validation now accommodate five-minute speech drafts;
- PostHog captures uncaught JavaScript failures, unhandled rejections, native crashes, and content-free voice lifecycle breadcrumbs. It still captures no audio, transcript, draft, message, filename, or console content;
- API failures return stable content-free codes for disabled, unconfigured, and provider failures;
- the EAS submit profile no longer attempts the redundant manual TestFlight group assignment that caused build 10 to be reported as errored after Apple had accepted it.

Production voice activation still requires a dedicated server-only provider key and explicit feature flag. Public App Review remains gated on accurate privacy disclosures, App Store privacy answers, provider data-control review, and the physical-device matrix. Internal TestFlight activation is intended to gather that acceptance evidence and must not be represented as public-release approval.

## 13. TestFlight build 11 provider and failure-layout incident

Physical testing on 2026-08-03 found that build 11 could record and preserve a draft but could not finish transcription. The screenshot timestamp was correlated with the production request log: the authenticated multipart request reached `POST /api/v1/transcriptions`, and the API returned `502` after the upstream provider rejected the deployed credential with `401 invalid_api_key`.

The required Render variables and feature flag were present. The root cause was a revoked key still deployed under `OPENAI_API_KEY`, not a missing client key or an iOS recording failure. Updating the masked secret in place did not replace the value used by the running service, so the stale variable was deleted and recreated with a dedicated server-only service-account credential. After deployment, production verification confirmed all three provider boundaries:

- the running service held the intended credential without exposing it in logs;
- the configured transcription model endpoint returned `200`, and a multipart audio transcription request returned `200`;
- the conservative cleanup request returned a valid structured draft.

Unused replacement and superseded provider keys were revoked after verification. Future non-success provider responses now emit only a content-free diagnostic event containing the request path, HTTP status, and allowlisted provider error type/code. Provider messages are deliberately excluded because they can contain partial credential material.

The crowded failure panel had a separate UI cause. A generic `flex: 1` style intended for copy inside horizontal status rows was also applied to copy inside the vertical error panel. On a compact iPhone layout, the copy and the wrapped three-button action row competed for height and visually collided. The error state now uses distinct row and column copy styles, keeps the full error text in its own bounded heading area, places the primary retry action on a full-width row, and gives **Record again** and **Dismiss** a separate flexible row with mobile-size touch targets. Failed audio remains available for retry and no draft is sent automatically.

# Voice-to-Text Messaging Plan

**Status:** Planned
**Last updated:** 2026-08-01
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
- short recordings, initially capped at 90 seconds;
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

The current Expo app has no recording library and its image-picker configuration explicitly sets `microphonePermission` to `false`. Voice input therefore requires a new native build, not an over-the-air JavaScript-only release.

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

Use a short technical spike to compare transcription accuracy, latency, cost, data handling, and Guam network behavior. A server-side transcription API is the preferred first architecture because it provides consistent native/web behavior and keeps provider credentials off clients. OpenAI’s transcription endpoint accepts common mobile formats including M4A and WebM, but provider selection remains an implementation decision rather than a permanent product dependency.

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
- The 90-second limit is enforced on both client and server.

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

**Gate:** one provider/architecture passes privacy, accuracy, and device feasibility review.

### Voice B — Native message draft (1–2 weeks)

- add permission and recording infrastructure;
- add the authenticated API endpoint and provider adapter;
- ship the record → transcribe → review → send flow in channel and direct messages;
- add deletion guarantees, analytics, unit/integration tests, and device tests.

**Gate:** no automatic send, no draft loss, no retained audio, and the physical-device acceptance suite passes.

### Voice C — Learning and instructor surfaces (about 1 week)

- reuse the flow in threads, contextual help requests, and concise grading feedback;
- add approved technical/course vocabulary;
- evaluate whether cleanup helps or merely creates editing work.

**Gate:** student and instructor surfaces use one shared implementation and role authorization remains correct.

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

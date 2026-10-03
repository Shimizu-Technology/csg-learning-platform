# Recording sections

CSG lessons should send a student to the smallest useful part of a recording. The full class replay can remain available, but attendance, breaks, unrelated questions, individual troubleshooting, and long work periods should not be part of the required path.

## What a finished lesson needs

Every lesson that uses a class recording should have:

1. One clear learning goal.
2. A recording source that still plays in the embedded player.
3. One or more reviewed start and end times.
4. A short label that says what the student will learn or do.
5. The right Core or Optional designation.
6. A practice task or acceptance check after the recording.

Use more than one section only when the lesson needs separate parts of the same recording. Do not create a section for classroom material the student should skip.

Good labels describe the teaching step: `Load API data with state and useEffect`. Avoid labels such as `Part 1`, `Continue`, or the recording's date.

## Choosing the range

Review the transcript and the video together. Start where the explanation or demonstration begins. Stop after the concept is complete, before the class moves into unrelated discussion or independent work.

- Exclude attendance, breaks, setup delays, unrelated questions, and student-specific debugging.
- Keep a useful question or debugging exchange when it directly teaches the lesson goal.
- Mark enrichment and alternate approaches Optional.
- Prefer a focused 10–30 minute required path. A longer range is acceptable when the concept cannot be split without losing the explanation.
- If a range contains a long unrelated gap, author two sections instead of asking the student to scrub through it.

For new material, record three to five focused clips of roughly 10–15 minutes rather than one long class replay. One concept per clip is the default.

## Student behavior

The lesson shows the focused sections under the player. Each row includes its exact start and stop time and the total Core viewing time. Selecting a row seeks and plays inside the existing YouTube, Vimeo, or hosted player. The player pauses at the reviewed end time and marks that section finished. Students can still use the full player controls when they intentionally want more context.

Saved watch progress and an explicit `?t=` deep link still control the initial resume point. Auto-stop applies only after the student selects a section.

## Source of truth

`api/config/video_segments.json` is the resolved production catalog for all curriculum recording blocks.

`api/config/focused_recording_segments.json` is the reviewed override catalog for the focused student path. Each entry is keyed by both production lesson ID and recording source ID. This prevents a reviewed range from being attached to the wrong lesson or to a replacement video.

After editing the focused catalog, rebuild the resolved catalog:

```sh
python3 scripts/build_video_segment_catalog.py \
  --base-catalog api/config/video_segments.json \
  --focused-catalog api/config/focused_recording_segments.json \
  --output api/config/video_segments.json
```

The command fails if a focused lesson is missing, duplicated, or points to a different recording source. Rails tests also verify all focused entries, sources, ranges, and metadata normalization.

Production receives reviewed catalog changes through a versioned data migration. The migration checks the content-block ID and recording source before changing metadata, preserves unrelated metadata, skips a newer edit, and restores the prior values on rollback.

An instructor can also edit sections in the lesson editor. Saving there records the sections as `staff_authored` with the current date and metadata version.

## Release check

Before merging a recording-section change:

- open at least one required lesson and one optional lesson as a student;
- confirm every row seeks to the displayed start time;
- confirm playback pauses at the displayed stop time;
- confirm Core and Optional labels match the lesson requirement;
- compare structured timestamps with any timestamps in the lesson notes;
- check the total Core viewing time for plausibility;
- verify web and mobile controls are readable and operable;
- run the Rails, web, and mobile checks required by CI.

After deployment, repeat the required and optional lesson checks on production. If the recording URL changes later, update and re-review the source ID and every focused range instead of carrying timestamps forward automatically.

# Video versions

A hosted video or recording block can have up to eight uploaded versions in `metadata.video_versions`. Each entry has a stable `id`, a short `label` (1–40 characters), and a managed `s3_video_key`. Array order determines the default. No data migration runs. Existing blocks without versions use their existing source.

Staff open the lesson editor, upload the original video, then use **Video versions → Add video version**. The initial list contains Original and Alternate; rename them, move them up/down, remove them, and Save. All changes use the lesson editor's existing concurrency check. Removing every version restores the original upload. Remove all versions before replacing that underlying upload.

The original `s3_video_key` remains the block's watch-credit anchor and storage reference. The stream endpoint returns the first version to old clients as well as the web player. `version_id` selects only an attached upload; it never accepts a raw storage key. All versions accumulate actual playback seconds into the existing single block progress row, under the existing server credit bounds and duration target. Switching preserves the current position, clamps to a shorter video's end, and retains cumulative watch seconds. Versions should cover the same lesson; they do not create separate completion requirements or reset learner work.

Web remembers the last selected stable id per block in optional browser storage. The selector is a labelled group of native pressed buttons, accessible with Tab and Enter/Space, and wraps at narrow widths. Storage failure and removal of a remembered version fall back to the default.

Installed mobile builds play the default using the existing stream endpoint. A native selector is follow-up work; no native release is included. The existing platform has no lesson caption-track attachment flow, so this change does not add captions. Existing video sections remain block-level; authors should only use shared section times when they fit every version.

## Orientation and acceptance (2026-11-20)

Base: `ae5e961c1e351883601a1d005a1a20f193fd2904`, origin/main. CSG Learn serves Code School of Guam students and staff. Lessons contain content blocks; class-library recordings are separate cohort-scoped records (`Recording`, `RecordDetail::RecordingPage`). Watch and completion evidence belongs to the content block, not the recording library. Sources: current models/controllers, `docs/PRODUCT_VISION.md`, and the supplied November 18/19 records in the task brief directory.

Required affected flows: legacy/default playback; two-version selection and position continuity; one shared watch total; browser preference/reload and removed-choice fallback; staff upload/label/reorder/remove/save/reload; 390/1280 Chromium layout and keyboard interaction. Storage-provider uploads are simulated in local QA; access and attachment rules have API/model coverage. Safari and native devices are unavailable on this host.

Production lesson 218 and learner records must remain unchanged. Only draft, unassigned curriculum 15 / lesson 894 is authorized for staging, after release and only if the two recordings are available. No automated data changes run on deploy.

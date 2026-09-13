# Alumni Learning Library

## Purpose

The CSG Alumni cohort is a permanent, self-directed learning community. Alumni can revisit every topic CSG has taught, compare current and historical class explanations, practice without grading, and receive new material as the curriculum evolves.

The alumni experience is a library, not another scheduled bootcamp:

- no deadlines, overdue states, or required-work progress;
- no assignment submissions or instructor grading;
- all assigned modules are available immediately;
- optional practice is presented as lesson content rather than a submission block;
- recordings remain available even when a newer recording is recommended;
- messaging and announcements remain active for community support and new material.

## Content structure

Create a dedicated `CSG Alumni Learning Library` curriculum and a permanent `CSG Alumni` cohort. Use these modules:

1. Start Here and What's New
2. Ruby and Programming Fundamentals
3. Rails APIs and Databases
4. JavaScript
5. React and Full-Stack Integration
6. Python and FastAPI
7. AI Engineering
8. Testing and Deployment
9. Professional Development
10. Workshops and New Material

Each topic has one canonical lesson. When several cohorts covered the same topic, keep the clearest current recording first and list the others as additional classroom recordings. Create separate lessons only when the objectives or implementation differ materially.

## Lesson contract

Every published alumni lesson should include:

1. **Why this matters** — the practical reason to revisit the topic.
2. **What you will learn** — two to five observable outcomes.
3. **Recommended recording** — the best current explanation and focused timestamps.
4. **Additional classroom recordings** — earlier or alternate explanations, labeled by cohort and date.
5. **Key ideas** — a concise summary of the recording.
6. **Version note** — current, legacy, historical, or supplemental, with a last-reviewed date.
7. **Example code** — exact links to starting code, completed code, and the comparison when available.
8. **Optional practice** — a concrete exercise written as ordinary lesson content, not a submission block.
9. **Done when** — observable checks alumni can perform for themselves.
10. **Further resources** — links to the canonical CSG Resources repository and current official documentation.

If original class code is unavailable, rebuild only what the recording demonstrates and label it `Reconstructed from the lesson recording`.

## Recording classifications

| Classification | Meaning |
| --- | --- |
| Current | Recommended CSG approach and supported versions |
| Legacy | Still educational, but uses a superseded version or pattern |
| Historical | Preserved for the classroom discussion or CSG history |
| Supplemental | Useful context that is not part of the core path |

All recordings can remain accessible. Classification controls prominence, not access.

## Platform behavior

The weekly-plan API returns `mode: library` for alumni cohorts. Web and mobile clients present an Alumni Learning Library card instead of week numbers, required progress, carried-forward assignments, or overdue language.

Every curriculum module is assigned and force-unlocked when an alumnus enrolls. Modules created later are added automatically to every active alumni enrollment. Converting an existing cohort to alumni or reactivating a paused alumni enrollment also restores any missing modules. Staff cannot remove a module from an alumni cohort.

Alumni lessons should use video, recording, reading, and text blocks. Optional practice belongs in a text block unless a future practice-only block is introduced. Do not configure GitHub synchronization, repository submissions, rubrics, submission windows, or grading for the alumni curriculum.

## Rollout and quality gate

Before inviting all alumni:

1. Reconcile the graduate roster and current email addresses.
2. Publish representative lessons from Rails, React, FastAPI, and AI Engineering.
3. Verify every recording and GitHub link as a student.
4. Verify that no alumni screen uses required, overdue, submission, or falling-behind language.
5. Test web and current iOS/Android builds.
6. Invite two or three alumni for feedback.
7. Correct navigation and content issues, then invite the full roster.

## Ongoing publishing workflow

For every new reusable class lesson:

1. preserve the recording;
2. add focused timestamps and a summary;
3. identify or create the matching code snapshot;
4. add optional practice and self-check criteria;
5. record versions and the review date;
6. publish it in the relevant alumni module;
7. announce material changes in the alumni workspace.

The canonical guides remain in `Code-School-of-Guam-Alumni/Resources`. Cohort repositories should link to a current branch or named release of that repository rather than copy the guide tree.

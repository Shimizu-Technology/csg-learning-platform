# Alumni Library Content Migration

This document is the working map for turning CSG's existing recordings, lesson plans, and code into the `CSG Alumni Learning Library` curriculum. It separates verified source material from material that still needs review, so an old class artifact is never presented as current by accident.

## Source order

Use sources in this order when building a lesson:

1. The Cohort 2 YouTube playlist is the most complete classroom record: 79 live-class recordings.
2. `Code-School-of-Guam-Alumni/Resources` contains the current setup and reference guides.
3. `Code-School-of-Guam-Alumni/Learning-Examples` contains runnable code matched to a recording or topic.
4. Original cohort repositories preserve the exact code shown in class. Link to immutable commits or tags.
5. Cohort 1 and Cohort 3 recordings are supplemental unless they contain the clearest or most current explanation.

Do not copy the Resources guide tree into a cohort or example repository. Link to the canonical repository instead.

## Evidence and reproducible sources

- Shared recording source: [Cohort 2 YouTube playlist](https://www.youtube.com/playlist?list=PLRpfxQ4ZG69WvQfcv9I-F5LtsQ3nwfj-f).
- Shared current guides: [Code-School-of-Guam-Alumni/Resources](https://github.com/Code-School-of-Guam-Alumni/Resources).
- Shared class code: the Code School of Guam cohort organizations on GitHub, linked to immutable commits from each lesson.
- Local-only video backup: `CSG/CSG-Live-July-2025 - Spam Bots/Recordings` and `CSG/CSG-PilotClass/Recordings` in Leon's synchronized CSG archive. Reproduce the review without that archive from the YouTube playlist.
- Local-only planning notes: `code-school/csg-cohort-2-recording-curriculum-map.md` and `code-school/lance-complete-curriculum.md` in Leon's synchronized Brain Dump. Published lesson metadata and this migration document are the portable result of that review.
- Local-only Drive export: `code-school/From-Google-Drive/Shimizu Technology, LLC-20251216T100426Z-3-001.zip` in Leon's synchronized Brain Dump. The original source is the Code School of Guam Google Drive curriculum folder; use the dated ZIP only as a frozen comparison copy.

The local Cohort 2 folder contains 72 live/final recordings, while the playlist contains 79. Reconcile those sets before calling the archive complete. The Drive backup also lacks top-level Week 6 and Week 12 plans, so those weeks require direct recording and repository review.

## First publishing set

Publish these lessons first. They cover the current Rails-to-React path and include the recordings already reviewed closely enough to classify. Focused timestamps and exact code mappings remain required before publication.

| Module | Lesson | Recording | Initial classification | Code source |
| --- | --- | --- | --- | --- |
| Rails APIs and Databases | One-to-many associations | [Cohort 2 W6D5](https://www.youtube.com/watch?v=IVqzUmIdFPk) | Current | Verified Cohort 3 Organizer API snapshots |
| Rails APIs and Databases | Serializers | [Cohort 2 W7D2](https://www.youtube.com/watch?v=mbkrFwA9m-4) | Current | Cohort 2 Rails API repositories; mapping pending |
| Rails APIs and Databases | Integrating a Rails API | [Cohort 2 W7D3](https://www.youtube.com/watch?v=Ugt-7pUF6l0) | Current | Cohort 2 full-stack app; mapping pending |
| Rails APIs and Databases | Many-to-many associations | [Cohort 2 W7D4](https://www.youtube.com/watch?v=aEv6D6UNd74) | Supplemental | Cohort 2 Rails API repositories; mapping pending |
| Rails APIs and Databases | Authentication and JWT | [Cohort 2 W8D1](https://www.youtube.com/watch?v=pfSrtsnlubg) | Supplemental | `auth-practice-api`; mapping pending |
| Rails APIs and Databases | Authorization with Pundit | [Cohort 2 W8D4](https://www.youtube.com/watch?v=umR507m_B9I) | Supplemental | `auth-practice-api`; mapping pending |
| Rails APIs and Databases | API namespaces | [Cohort 2 W9D1](https://www.youtube.com/watch?v=pTyaJQAN6tM) | Current | Cohort 2 Rails API repositories; mapping pending |
| JavaScript | JavaScript fundamentals | [Cohort 2 W11D1](https://www.youtube.com/watch?v=sDzzZ2Hvdb0) | Current | `modern-js`; mapping pending |
| JavaScript | Working with JavaScript data | [Cohort 2 W11D2](https://www.youtube.com/watch?v=63HiSNt1dFw) | Current | `modern-js`; mapping pending |
| JavaScript | Loops and iteration | [Cohort 2 W11D3](https://www.youtube.com/watch?v=jvupC1Yr5pw) | Current | `modern-js`; mapping pending |
| React and Full-Stack Integration | React components and props | [Cohort 2 W13D2](https://www.youtube.com/watch?v=tUPxrIdwr_E) | Current | Cohort 2 React repositories; mapping pending |
| React and Full-Stack Integration | Loading API data in React | [Cohort 2 W13D3](https://www.youtube.com/watch?v=3SW_W7PmEd4) | Current | Cohort 2 full-stack app; mapping pending |
| React and Full-Stack Integration | Create actions in React | [Cohort 2 W14D1](https://www.youtube.com/watch?v=ONQWBuboH6A) | Current | Cohort 2 full-stack app; mapping pending |
| React and Full-Stack Integration | Update and delete actions in React | [Cohort 2 W14D2](https://www.youtube.com/watch?v=jq7eXTuQRmc) | Current | Cohort 2 full-stack app; mapping pending |
| Testing and Deployment | Deploying the full-stack application | [Cohort 2 W15D5](https://www.youtube.com/watch?v=Otzinb2xcuQ) | Current pending provider review | Cohort 2 full-stack app; mapping pending |
| Python and FastAPI | Moving from JavaScript to Python | [Cohort 2 W16D1](https://www.youtube.com/watch?v=6L_8jqmVe8o) | Current | Python/FastAPI example required |
| Python and FastAPI | Python API development | [Cohort 2 W16D2](https://www.youtube.com/watch?v=qTh6G1_MyI8) | Current | Python/FastAPI example required |
| AI Engineering | Chatbots and API wrappers | [Cohort 2 W16D3](https://www.youtube.com/watch?v=fCXHKhI82Bw) | Current | `spam-bots-chatbot`; mapping pending |
| Professional Development | Scoping a capstone | [Cohort 2 W17D1](https://www.youtube.com/watch?v=0i1BAAW6GhQ) | Current | No code snapshot required |
| Professional Development | Project handoff | [Cohort 2 W18D1](https://www.youtube.com/watch?v=M56EpVXGOm4) | Current | No code snapshot required |

`Current` here means the recording is a candidate for the recommended path. It does not waive the lesson-level version check.

## Full-library migration

For each of the 79 playlist recordings:

1. confirm the title, date, duration, and topic;
2. compare it with the day plan and repository history;
3. write a short factual summary and focused timestamps;
4. mark each segment current, legacy, historical, or supplemental;
5. map the exact starting and completed code states;
6. verify both states from a clean clone;
7. create one canonical lesson per topic and attach alternate recordings there;
8. add optional practice and observable self-checks;
9. preview the lesson as an alumni student before publishing.

Keep a recording accessible even when it is not recommended. The classification and ordering should explain why an alumnus might still watch it.

## Code curation rules

The raw class folders are evidence, not the public library. Cohort 2 contains 56 Git repositories and the pilot contains 45, with duplicates and in-progress states. Do not publish them wholesale.

Strong starting candidates are:

- `week-1`
- `cookbook_api`
- `auth-practice-api`
- `full-stack-app`
- `modern-js`
- `cookbook-backend` and `cookbook-frontend`
- `spam-bots-chatbot`

Each published example needs immutable start and complete links, setup commands, a verification date, and a note when the recording uses an older pattern than CSG recommends today.

## Alumni rollout

The current roster evidence contains 11 graduates: six from Cohort 1 and five from Cohort 2. Confirm current email addresses from the cohort spreadsheets before inviting anyone.

Do not send the full invitation until:

- the dedicated curriculum and alumni cohort exist;
- representative Rails, React, FastAPI, and AI lessons pass student-preview review;
- required/overdue/submission language is absent from the alumni experience;
- links work without instructor-only GitHub or Drive access;
- two or three alumni have tested the library and reported any access or navigation problems.

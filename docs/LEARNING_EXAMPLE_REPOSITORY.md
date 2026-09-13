# Learning Example Repository Contract

## Goal

Recordings explain how an instructor reasons through a problem. Exercises let a learner practice. Example code preserves the exact runnable state that connects the two.

CSG example repositories must remain useful after the live class and must not depend on an instructor remembering which commit matched a recording.

## Repository strategy

Use the existing cohort repositories as exact historical evidence when the matching class code is already present. Create canonical maintained examples in the CSG Alumni organization for topics that need a stable current reference.

Prefer a small set of repositories by technical area:

- Ruby examples
- Rails API reference
- JavaScript examples
- React reference
- FastAPI reference
- AI Engineering examples

Use lesson folders for isolated examples. Use one evolving application with Git tags for multi-lesson projects.

## Snapshot convention

Each evolving lesson uses two immutable tags:

```text
lesson/<lesson-slug>/start
lesson/<lesson-slug>/complete
```

The platform lesson links to the two tagged trees and a GitHub comparison. Never link only to a moving `main` branch when the recording depends on a specific code state.

Do not rewrite or move a published lesson tag. If a correction is necessary, create a versioned tag such as:

```text
lesson/<lesson-slug>/complete-v2
```

Explain the correction in the lesson and repository README.

## Required README metadata

Every lesson folder or tagged snapshot must identify:

- CSG lesson title;
- module and topic;
- recording URL and focused timestamps;
- supported language and framework versions;
- setup and run commands;
- expected behavior;
- common mistakes;
- whether the code is original or reconstructed;
- last verification date.

Never place student secrets, API keys, private data, or copied environment files in an example repository. Use `.env.example` with non-secret placeholders where configuration is needed.

## Student presentation

Current students see links in this order:

1. starter code;
2. exercise and done-when criteria;
3. completed reference code under `Use this after you try`;
4. comparison showing the lesson's change.

Alumni may see all links immediately. Reference code is a learning resource, not a graded answer.

## Verification

Before linking an example from a published lesson:

1. clone it into a clean temporary directory;
2. check out both lesson tags;
3. follow the documented setup commands;
4. run its tests or documented verification command;
5. compare the completed state with the recording;
6. test every platform link;
7. record the verification date.

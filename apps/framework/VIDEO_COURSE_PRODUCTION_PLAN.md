# Framework YouTube course production plan

Status: recording plan. No videos, lesson checkpoints, or companion code have been published.

The three playlists follow one independent db3 application. A viewer can finish after the first course with a working private notes app, continue to the AI course to add a note assistant, or take the coding-agent course to add tags. The planned running times match the current `/framework/learn` outlines: 8 videos / 58 minutes, 6 videos / 50 minutes, and 5 videos / 36 minutes. Treat these as edited targets, not promises about a finished recording.

## Recording format and preparation

- Open each video with the working result or the failure the lesson will resolve. Then state the one thing the viewer will be able to do at the end.
- Record the real editor, terminal, and browser. Use short diagrams only to explain a boundary that is hard to see in code. Keep a visible step number and the current project state on screen.
- Give each video a standalone YouTube title with its course and lesson number, plus a playlist link. Put the matching written guide, prerequisites, relevant code checkpoint, and any correction in the description. Add chapters after editing the recording.
- Prepare a disposable local database, two test accounts, and non-sensitive sample notes. Mask environment values. Automated AI tests use simulated provider responses; an optional live demonstration uses a separately controlled server key and is never required for the lesson to pass.
- Build and verify the complete course feature before recording. Save a reproducible starting and ending code checkpoint for each video, with migrations and fixture data where needed. Do not label these checkpoints downloadable until they exist and have been tested outside the authoring checkout.
- The starter already supplies password sign-in, private notes, and an optional server-side summary. Collections, the course's richer AI assistant, and tags are proposed application changes to build and validate for these recordings.
- Publish the first three first-app videos as a pilot. Check whether a new developer can reach the same running app using only the videos and guides before recording the rest.

## Playlist 1 — Build your first db3 app

**Audience:** Developers comfortable with basic TypeScript and Vue. **Project:** Private notes, then private note collections. **Prerequisites:** Node.js 24+, npm, and local MariaDB or MySQL for the database lessons. **Written course:** `/framework/learn/build-your-first-app`.

### 1. What we are building — target 3 min

- **Open:** Show the finished app: sign in, create a note, move it into a collection, reload, and find it again.
- **Teach:** Identify what the starter already provides (authentication, private notes, optional summary) and what this course adds (collections). Show the final result before showing code.
- **End state:** The viewer knows the product goal and why the next video starts with the creator. Link the starter guide (`/framework/docs/starter-app`).

### 2. Create and run the project — target 8 min

- **Open:** Start from an empty directory and show the expected signed-in Notes screen.
- **Teach:** Check Node and database prerequisites; follow the current creator guide; configure the app's local environment; run the committed migrations; start the app; register or sign in and save one note. Show one realistic setup failure and the specific setting that resolves it.
- **End state:** A generated app running locally with a note that survives reload. Show where the viewer can find the exact commands in the starter guide (`/framework/docs/starter-app`). Never display credentials.

### 3. Find your way around — target 6 min

- **Open:** Ask where the saved note travels after the Save button is pressed.
- **Teach:** Follow one request from the Vue component to the server route, model, database, and existing test. Point out `client/`, `server/`, migrations, and tests. Make one small visible copy change and reload the app.
- **End state:** A simple mental map and one verified UI change. Link the project-structure guide (`/framework/docs/project-structure`). This ends the pilot release.

### 4. Model a collection — target 9 min

- **Open:** Show why a plain text collection name on each note cannot reliably represent one private collection.
- **Teach:** Add an owner-scoped Collection model and the note relationship. Explain the fields and migration; generate, review, apply, and inspect the schema. Create sample records and check what a second account can see before a UI exists.
- **End state:** The database can store private collections without losing existing notes. Link ActiveRecord (`/framework/docs/active-record`).

### 5. Build the collection workflow — target 10 min

- **Open:** Show the finished Create collection and Move note interactions.
- **Teach:** Add narrow server routes with input validation and current-user ownership. Connect the Vue form and note action, show pending and error states, then save and reload. Explain why the browser supplies intent while the server decides ownership.
- **End state:** One note can move into a new collection and remain there after reload. Link the application API guide (`/framework/docs/guide-api`).

### 6. Keep collections private — target 8 min

- **Open:** Attempt to open another account's collection URL and show the denial.
- **Teach:** Trace session identity through the routes. Scope reads and writes by owner; test guessed IDs for both collections and notes. Show the difference between hiding a UI control and refusing an unauthorized server action.
- **End state:** Account B cannot read or change Account A's collection or note. Link authentication (`/framework/docs/auth`).

### 7. Test the whole feature — target 9 min

- **Open:** Show a passing happy path, then intentionally make one test fail.
- **Teach:** Cover create, rename or move, invalid input, cross-account access, and persistence. Assert the stored result as well as the HTTP response. Repair the introduced failure and rerun the focused suite; include a short browser check.
- **End state:** A green feature suite and an understood failure message. Link testing (`/framework/docs/testing`).

### 8. Finish and choose a next path — target 5 min

- **Open:** Complete the full note-and-collection journey without editing code.
- **Teach:** Review the diff and migration, run the app build and relevant tests, and distinguish local checks from release or deployment. Recap which files the viewer can now change independently. Preview the optional AI and coding-agent playlists.
- **End state:** A reviewable local application checkpoint, with no claim that it has been hosted. Link the AI overview (`/framework/docs/ai`).

## Playlist 2 — Build AI features into your app

**Audience:** App developers who have completed Playlist 1 or know the starter. **Project:** A private note assistant that summarises a note and answers questions through an authorized app function. **Written course:** `/framework/learn/ai-features`.

### 1. Pick a useful AI task — target 5 min

- **Open:** Show a long note and the concise result the user actually needs.
- **Teach:** Define the request, useful response, missing-key behavior, refusal boundary, and failure state before touching provider code. Keep the saved note as source of truth. Sketch the path from browser to authorized server route to provider.
- **End state:** A small acceptance checklist for the note assistant. Link the AI overview (`/framework/docs/ai`).

### 2. Add a server-side summary — target 9 min

- **Open:** Use the starter's existing Summary action; then repeat with AI unconfigured to show its real fallback.
- **Teach:** Walk through the current `summariseNote` service, owner-scoped note lookup, server-only key configuration, output limit, and provider error handling. Make one small improvement to the feature rather than presenting the starter summary as something newly built.
- **End state:** A summary path the viewer can explain and test without placing a key in browser code. An optional live call is clearly labelled as a demonstration. Link the AI guide (`/framework/docs/ai`).

### 3. Return dependable output — target 8 min

- **Open:** Show a UI that needs separate summary and suggested-title fields, rather than free-form prose.
- **Teach:** Add schema-validated structured generation with a narrow Zod schema. Handle invalid or unusable output, and treat generated content as untrusted data. Keep factual checks and persistence decisions in application code.
- **End state:** The UI receives only validated fields or a useful error; the note remains unchanged. Link structured data (`/framework/docs/ai-embeddings`).

### 4. Give an agent one safe tool — target 11 min

- **Open:** Ask a question about an approved note, then attempt a question about another account's note.
- **Teach:** Add one read-only note function with validated arguments. Bind its owner and scope from the authenticated request, not from model-selected arguments. Show an allowed tool call and a denied lookup, then explain where the agent records its work.
- **End state:** The assistant can answer from an authorized note and cannot retrieve a guessed private note. Link agents and function calls (`/framework/docs/ai-agents`).

### 5. Show progress and recover — target 9 min

- **Open:** Compare a silent wait with a UI that shows tool progress and a completed answer.
- **Teach:** Forward typed run events to the browser, render progress and failure, then reload an authorized saved conversation. Explain when a longer task would move to background work; do not add a queue merely for this short demo.
- **End state:** A user can see what is happening and recover the conversation after reload. Link conversations (`/framework/docs/ai-conversations`).

### 6. Test cost and failure boundaries — target 8 min

- **Open:** Show a simulated provider failure and the app's useful error state.
- **Teach:** Exercise the real app route and framework runtime with simulated external provider responses. Check cross-account denial, unusable output, failure without partial writes, and recorded usage. Show where application-specific rate or spending limits belong before release.
- **End state:** A passing automated suite with no paid provider request, plus a documented release checklist. Link usage and tracking (`/framework/docs/ai-usage`).

## Playlist 3 — Vibe code with db3

**Audience:** Builders using a coding assistant with a local checkout. **Project:** Add note tags to the same app, then decide whether the change is ready to keep. Keep the series tool-agnostic; show the actual prompts and final diff. **Written course:** `/framework/learn/vibe-code-with-db3`.

### 1. Give the agent a bounded task — target 6 min

- **Open:** Demonstrate the desired Add tag and Filter by tag behavior on a prepared end-state build.
- **Teach:** Write an agent request with the user outcome, affected app, current-user ownership, migration requirement, and acceptance checks. Point it to the app's agent instructions and relevant framework guides. Keep the request to this one feature.
- **End state:** A prompt and checklist that can be judged against observable behavior. Link project structure (`/framework/docs/project-structure`).

### 2. Inspect the proposed change — target 8 min

- **Open:** Read the changed-file list before running anything.
- **Teach:** Review model fields, migration, route, UI, and tests against the requested feature. Check supported imports, data access, ownership, and whether the agent invented APIs or added unrelated abstractions. Ask for one focused correction if needed.
- **End state:** A small, understood diff with explicit open questions. Link project structure (`/framework/docs/project-structure`).

### 3. Run the app together — target 8 min

- **Open:** Try to add, remove, and filter tags in the browser.
- **Teach:** Record an observed failure, give the agent the exact steps and output, review its repair, and rerun the same flow. Keep the browser demo in a disposable local environment.
- **End state:** The visible behavior matches the original acceptance check. Link the API guide (`/framework/docs/guide-api`).

### 4. Prove the boundaries — target 9 min

- **Open:** Ask whether a tag name alone is enough to edit another account's note.
- **Teach:** Test valid and invalid input, cross-account attempts, migration behavior, and persistence. Run focused checks and the relevant app build. Simulate external providers only; keep framework and database behavior real.
- **End state:** Evidence for what passed and what still needs review. Link testing (`/framework/docs/testing`).

### 5. Keep or revert with confidence — target 5 min

- **Open:** Compare the final diff against the original task and test evidence.
- **Teach:** Remove unrelated changes, state the exact checks run, and decide whether to keep or revert the feature. If keeping it, commit only the intended files; distinguish the commit from a push, release, or deployment. Show a clean reversal in a disposable branch as an alternative ending.
- **End state:** A defensible local decision and a reproducible change record. Link testing (`/framework/docs/testing`).

## Publication order and completion criteria

1. Build the full first-app end state and its lesson checkpoints; record videos 1–3 as the setup pilot.
2. Use a fresh machine or clean checkout to follow that pilot with only the video and linked guide. Resolve every missing step before recording videos 4–8.
3. Finish and publish Playlist 1 with its verified companion checkpoints. Then prepare the AI application work and publish Playlist 2.
4. Record Playlist 3 using a fresh, disposable branch so the agent's real proposal, review, failures, and repairs can be shown accurately.
5. Before publishing each video, verify the demonstrated command, UI, guide link, checkpoint, and description against the framework revision used for recording. Label any unreleased feature or optional service explicitly.

# Word Quest MVP

`word-quest` is a SvelteKit + MongoDB vocabulary trainer built around AI-generated quiz cards and review state.

## Data Model

- `voca`
  - One study entry per `sourceText + sourceDefinition + targetText + targetLang` sense pair.
  - Stable metadata:
    - `difficultyLevel`
    - `utilityScore`
- `quizCard`
  - One quiz asset per `voca`.
  - Holds `examples[]`.
- `quizExample`
  - Subdocument inside `quizCard.examples[]`.
  - Each example contains prompt/answer templates and pronunciation text.
- `review`
  - Progress state keyed by `userId + vocaId + promptLang + answerLang`.
  - Holds spaced-repetition state plus per-example weighting:
    - `reviewStage`
    - `dueAt`
    - `correctCount`
    - `wrongCount`
    - `exampleScoreById`
- `answerMemo`
  - AI wrong-answer feedback cache.
  - Cache key: `quizExampleId + promptLang + answerLang + normalizedAnswerText`.
  - This cache is never the grading authority.
- `user`
  - Stores:
    - `_id`
    - `email`
    - `name`
    - `currentLevel`
    - `levelHistory`

## Quiz Flow

- There is one quiz flow. `level test` no longer exists as a separate mode.
- Exact normalized match is the only automatic correct answer rule.
- Wrong answers stay wrong unless the user later submits the exact answer.
- Client behavior:
  1. Run through the current batch once.
  2. Requeue only passed/wrong cards.
  3. Repeat until every card is answered correctly.
- Server actions:
  - `POST /api/quiz/check`
    - Returns `correct` immediately on exact match and persists review progress.
    - Returns cached wrong-answer feedback on miss when present.
    - Does not persist review progress on a wrong check.
  - `POST /api/quiz/pass`
    - Immediately persists the wrong result.
    - Returns the correct answer payload.
  - `POST /api/quiz/judge`
    - Reuses cached wrong-answer feedback when present.
    - Otherwise asks AI once and stores the result in `answerMemo`.

## Level System

- `currentLevel` is a single stored value for the user.
- It is recomputed after each persisted `correct` or `pass`.
- Source of truth:
  - Distinct learned `vocaId` whose `reviewStage >= LONG_TERM_REVIEW_STAGE`.
  - Use the learned voca `difficultyLevel` values.
- Calculation:
  - `currentLevel = nearest-rank P75` of learned difficulty levels.
  - Fallback to `1` when there are no learned voca yet.
- `levelHistory`
  - Seed when empty.
  - Append only when `currentLevel` changed and the history throttle window has passed.

## New Card Selection

- Due reviews always come first.
- If due reviews are fewer than the quiz batch size, fill the rest with new cards.
- New-card candidates must already have both `difficultyLevel` and `utilityScore`.
- Difficulty gate:
  - Lower bound: `currentLevel - 1`
  - Upper bound:
    - `currentLevel + 3` when learned voca count is below `20`
    - `currentLevel + 1.5` otherwise
- Sort order inside the selector:
  1. `utilityScore` descending
  2. Preferred zone order:
     - `[currentLevel, currentLevel + 1]`
     - `[currentLevel - 1, currentLevel)`
     - `(currentLevel + 1, upperBound]`
  3. Absolute distance from `currentLevel` ascending
  4. `createdAt` ascending
- If gated candidates are insufficient, append the remaining candidates with the same ordering outside the gate.

## AI Rules

- AI card generation receives:
  - `sourceText`
  - `sourceDefinition`
  - `targetText`
  - `targetDefinition`
  - `targetLang`
- AI returns:
  - `difficultyLevel`
  - `utilityScore`
  - `examples[]`
- `difficultyLevel` and `utilityScore` stay stable after creation.
- Quiz outcomes no longer mutate `voca.difficultyLevel`.

## Architecture

- `models`
  - Mongoose schema definitions.
- `repositories`
  - Database reads/writes and POJO mapping.
- `service`
  - Small domain helpers such as review math, user-level rebuild, AI calls, and metadata filling.
- `usecases`
  - Route-facing orchestration for quiz and add flows.
- `routes`
  - SvelteKit pages and API entrypoints.

## Verification

- `npm.cmd run test`
- `npm.cmd run check`
- `npm.cmd run lint`

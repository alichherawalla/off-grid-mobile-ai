# Project Instructions

## Pre-Commit Quality Gates

All quality gates run automatically via Husky on every `git commit`, scoped to the file types you staged:

| Staged file type | Checks that run automatically |
|---|---|
| `.ts` / `.tsx` / `.js` / `.jsx` | eslint (staged only), `tsc --noEmit`, `npm test` |
| `.swift` | swiftlint (staged only), `npm run test:ios` |
| `.kt` / `.kts` | `compileDebugKotlin` (type check), `lintDebug`, `npm run test:android` |

**Requirements:**
- SwiftLint: `brew install swiftlint` (skipped with a warning if not installed)
- Android checks require the Gradle wrapper in `android/`

Before writing new code, ensure tests exist for your changes. If the hook fails, fix the issue and recommit — never skip with `--no-verify`.

## Push = Create PR + Address Review

When asked to push code, follow this full workflow:

0. ensure that you are on a branch that is specific to this change i.e feat/new-feature or fix/bug-fix or docs/update-readme or chore/update-dependencies, or test/new-test, etc
1. Push the branch to the remote (`git push -u origin <branch>`)
2. Create a PR using `gh pr create`. Ensure that you are adhering to the PR template. **Do NOT include "Generated with Codex" or any AI attribution in PR descriptions.**
3. Wait for Gemini to review the PR (poll with `gh pr checks` and `gh api repos/{owner}/{repo}/pulls/{number}/reviews` until a review appears)
4. Once a review exists, pull down the review comments: `gh api repos/{owner}/{repo}/pulls/{number}/comments` and `gh api repos/{owner}/{repo}/pulls/{number}/reviews`
5. Address every review comment — fix the code, re-run the quality gates (tests, lint, tsc). Resolve the comment appropriately and post that on the PR directly.
6. Push the fixes
7. Report what was changed in response to the review

## CI Review Loop

The repo has three automated reviewers on every PR. After pushing, loop until all are green:

| Reviewer | What it checks | How to address |
|---|---|---|
| **Gemini Bot** | Code quality, style, logic issues | Read comments via `gh api`, fix code or reply explaining why it's fine, then comment `/gemini review` to trigger a fresh pass |
| **Codecov** | Test coverage thresholds | Add missing tests, ensure new code is covered. Check the Codecov report for uncovered lines |
| **SonarCloud** | Security hotspots, code smells, duplications, bugs | Fix flagged issues — especially security hotspots and duplications. Resolve quality gate failures before merging |

**Workflow:**
1. Push code → wait for all three reviewers to report
2. Pull down Gemini comments, Codecov report, and SonarCloud findings
3. Fix issues: code changes for Gemini/SonarCloud, add tests for Codecov
4. Re-run local quality gates (`npm run lint && npm test && npx tsc --noEmit`)
5. Push fixes, comment `/gemini review` on the PR to re-trigger Gemini
6. Repeat until all three reviewers pass with no blocking issues

---
name: test-and-fix
description: Run tests for modified files, analyze failures, and fix them systematically
tags: [testing, debugging, automation]
---

# Execution Mode

**IMPORTANT**: Before proceeding, determine how this skill was invoked:

- **Manual invocation**: User explicitly requested this skill (typed `/test-and-fix`)
  - → Execute the steps below directly in the current conversation

- **Automatic invocation**: You (Claude) proactively decided to run tests as part of a larger task
  - → Use the Task tool with `subagent_type: "general-purpose"` instead
  - → Pass these instructions to the subagent as the prompt
  - → Let the subagent execute the workflow autonomously

# Steps

## 1. Identify Modified Files and Related Tests

- Get list of modified files from git status
- Find related test files (`.spec.ts`) for each modified file
- Include both unit tests and integration tests where applicable

## 2. Discover Test Commands

Before running tests, identify how tests are executed in this codebase:

- **Check package manager**: Determine if the project uses npm, yarn, or pnpm (check for yarn.lock, package-lock.json, or pnpm-lock.yaml)
- **Check package.json**: Look for test scripts (e.g., `npm test`, `yarn test`, `npm run test:unit`, etc.)
- **Check Makefile**: Look for test targets (`make test`, `make test-unit`, etc.)
- **Check README**: Look for documented test commands in README or CONTRIBUTING files
- **Check test configs**: Look for test runner configs (jest.config.js, vitest.config.ts, etc.) that may indicate the test framework and how to run specific tests
- **Identify test patterns**: Determine how to run tests for specific files or patterns (e.g., `npm test -- path/to/file`, `yarn test path/to/file`, `jest path/to/file`)

## 3. Run Targeted Tests

- Execute tests using the discovered commands with file patterns for related test files
- For targeted testing, prefer commands that can run specific test files rather than entire test suites
- Capture and analyze test output for failures

## 4. Analyze Test Failures

For each failed test, categorize the failure type:

- **Flaky Test**: Intermittent failures, timing issues, or race conditions
- **Mock/Data Issues**: Test data or mocks out of sync with code changes
- **Breaking Changes**: Code changes that require test updates
- **Critical Logic Errors**: Actual bugs in implementation
- **Environment Issues**: Missing dependencies, configuration problems

## 5. Fix Tests Systematically

For each failed test (one at a time):

- **Flaky Tests**: Add proper waits, fix race conditions, stabilize test environment
- **Mock Issues**: Update mock data, stub configurations, or test fixtures
- **Breaking Changes**: Update test expectations, assertions, or test structure
- **Logic Errors**: Fix the actual implementation code causing the failure
- **Environment**: Update test setup, dependencies, or configuration

## 6. Verify Each Fix

After each fix:

- Re-run the specific test that was failing
- Ensure the fix doesn't break other tests
- Run related test suite if needed
- Move to next failed test only after current one passes

## 7. Final Verification

- Run all tests for modified files once more
- Ensure no new failures were introduced

# Notes

- Focus on files modified in current working tree
- Respect the project's testing patterns and mock strategies

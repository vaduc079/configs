# Test and Fix Modified Files

## Description

Runs tests for currently modified files, analyzes failures, and fixes them systematically.

## Steps

### 1. Identify Modified Files and Related Tests

- Get list of modified files from git status
- Find related test files (`.spec.ts`) for each modified file
- Include both unit tests and integration tests where applicable

### 2. Run Targeted Tests

- Execute tests with file patterns for related test files
- Capture and analyze test output for failures

### 3. Analyze Test Failures

For each failed test, categorize the failure type:

- **Flaky Test**: Intermittent failures, timing issues, or race conditions
- **Mock/Data Issues**: Test data or mocks out of sync with code changes
- **Breaking Changes**: Code changes that require test updates
- **Critical Logic Errors**: Actual bugs in implementation
- **Environment Issues**: Missing dependencies, configuration problems

### 4. Fix Tests Systematically

For each failed test (one at a time):

- **Flaky Tests**: Add proper waits, fix race conditions, stabilize test environment
- **Mock Issues**: Update mock data, stub configurations, or test fixtures
- **Breaking Changes**: Update test expectations, assertions, or test structure
- **Logic Errors**: Fix the actual implementation code causing the failure
- **Environment**: Update test setup, dependencies, or configuration

### 5. Verify Each Fix

After each fix:

- Re-run the specific test that was failing
- Ensure the fix doesn't break other tests
- Run related test suite if needed
- Move to next failed test only after current one passes

### 6. Final Verification

- Run all tests for modified files once more
- Ensure no new failures were introduced

## Notes

- Focus on files modified in current working tree
- Respect the project's testing patterns and mock strategies

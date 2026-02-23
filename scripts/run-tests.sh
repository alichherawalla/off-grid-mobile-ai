#!/bin/bash

# Run Maestro E2E tests in alphabetical order
# Usage: ./run-tests.sh [folder]
# Example: ./run-tests.sh p0

TEST_DIR="${1:-.maestro/flows/p2}"
FAILED_TESTS=()
PASSED_TESTS=()

echo "Running tests from: $TEST_DIR"
echo "================================"

# Find all .yaml files and sort them
for test_file in $(find "$TEST_DIR" -name "*.yaml" -type f | sort); do
    echo ""
    echo "Running: $test_file"
    echo "--------------------------------"
    
    if maestro test "$test_file"; then
        PASSED_TESTS+=("$test_file")
        echo "✅ PASSED: $test_file"
    else
        FAILED_TESTS+=("$test_file")
        echo "❌ FAILED: $test_file"
        echo "Stopping on first failure..."
        break
    fi
done

echo ""
echo "================================"
echo "Test Summary"
echo "================================"
echo "Passed: ${#PASSED_TESTS[@]}"
echo "Failed: ${#FAILED_TESTS[@]}"

if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
    echo ""
    echo "Failed tests:"
    printf '%s\n' "${FAILED_TESTS[@]}"
    exit 1
fi

echo ""
echo "All tests passed! 🎉"
exit 0

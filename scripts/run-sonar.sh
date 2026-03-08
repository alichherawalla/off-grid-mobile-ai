#!/usr/bin/env sh

set -eu

if [ -z "${SONAR_TOKEN:-}" ]; then
  echo "SONAR_TOKEN is not set. Skipping Sonar scan."
  exit 0
fi

if [ -x "./node_modules/.bin/sonar-scanner" ]; then
  exec ./node_modules/.bin/sonar-scanner "$@"
fi

if command -v sonar-scanner >/dev/null 2>&1; then
  exec sonar-scanner "$@"
fi

echo "sonar-scanner is not installed. Skipping Sonar scan."
echo "Install it with: npm install --save-dev sonar-scanner"
exit 0

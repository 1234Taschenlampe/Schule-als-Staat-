#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
rm -rf _site
mkdir -p _site
cp index.html app.js config.js styles.css features.js features.css verification.js verification.css roles.js attendance.js tutorial.js tutorial.css _site/
# The old V3 prototype remains archived in GitHub but is NOT deployed.
touch _site/.nojekyll
printf 'Static V4 bundle prepared: %s\n' "_site/"

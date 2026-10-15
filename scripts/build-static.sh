#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p _site
cp index.html app.js config.js styles.css _site/
touch _site/.nojekyll
printf 'Static V4 bundle prepared: %s\n' "_site/"

#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
rm -rf _site
mkdir -p _site
cp index.html app.js config.js styles.css features.js features.css physical-card-shop.css physical-card-shop.js roles.js attendance.js tutorial.js tutorial.css work-hours.js shop-management.js admin-credit.js brand-emblem.css public-visa.js public-visa.css shop-plan.js shop-plan.css mobile-ui.css portal-extras.js portal-extras.css flag-voting.js flag-voting.css _site/
# The old V3 prototype remains archived in GitHub but is NOT deployed.
touch _site/.nojekyll
printf 'Static V4 bundle prepared: %s\n' "_site/"

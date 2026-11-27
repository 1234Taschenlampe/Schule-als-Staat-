import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const allowed = new Set('index.html app.js config.js styles.css features.js features.css physical-card-shop.css physical-card-shop.js roles.js attendance.js tutorial.js tutorial.css work-hours.js shop-management.js admin-credit.js brand-emblem.css public-visa.js public-visa.css shop-plan.js shop-plan.css mobile-ui.css portal-extras.js portal-extras.css flag-voting.js flag-voting.css .nojekyll'.split(' '));
test('static deployment contains only explicitly approved assets', () => {
  execFileSync('sh', ['scripts/build-static.sh'], {stdio:'pipe'});
  assert.ok(lstatSync('_site').isDirectory());
  const seen = new Set();
  function visit(dir, prefix = '') {
    for (const name of readdirSync(dir)) {
      const file = join(dir,name);
      const rel = prefix + name;
      const stat = lstatSync(file);
      assert.ok(!stat.isSymbolicLink(), 'Symlink in public bundle: '+rel);
      if (stat.isDirectory()) {
        assert.ok(rel === 'assets' || rel === 'assets/flags', 'Unexpected directory: '+rel);
        visit(file,rel+'/');
      } else {
        assert.ok(stat.isFile(), 'Unexpected file type: '+rel);
        assert.ok(allowed.has(rel) || /^assets\/flags\/entwurf-[A-Za-z0-9_-]+\.webp$/.test(rel), 'Unapproved public asset: '+rel);
        seen.add(rel);
      }
    }
  }
  visit('_site');
  for (const name of allowed) assert.ok(seen.has(name),'Missing approved asset: '+name);
});

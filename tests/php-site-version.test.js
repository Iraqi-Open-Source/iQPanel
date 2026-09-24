/**
 * Site PHP selection and "installed" detection.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, readlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { phpVersionReady } from '../agent/actions/php.js';
import { composerWrapper, installPhpShims } from '../agent/actions/exec.js';

describe('php install status', () => {
  test('a version is not installed until cli and fpm packages are fully configured', () => {
    const probe = {
      binExists: (p) => p === '/usr/bin/php8.1',
      packageStatus: (name) => (name === 'php8.1-cli' ? 'install ok unpacked' : 'install ok installed'),
    };
    assert.equal(phpVersionReady('8.1', probe), false);

    probe.packageStatus = (name) => (
      name === 'php8.1-cli' || name === 'php8.1-fpm' ? 'install ok installed' : ''
    );
    assert.equal(phpVersionReady('8.1', probe), true);
    assert.equal(phpVersionReady('8.4', probe), false);
  });
});

describe('site php shims', () => {
  test('composer wrapper invokes the site php, not the system default', () => {
    assert.equal(
      composerWrapper('/usr/bin/php8.1', '/usr/bin/composer'),
      '#!/bin/sh\nexec /usr/bin/php8.1 /usr/bin/composer "$@"\n',
    );
  });

  test('installs php and composer shims ahead of PATH', () => {
    const root = mkdtempSync(join(tmpdir(), 'iqpanel-phpbin-'));
    const phpBin = join(root, 'php8.1');
    const composerBin = join(root, 'composer-real');
    writeFileSync(phpBin, '#!/bin/sh\necho "php:$1"\n');
    chmodSync(phpBin, 0o755);
    writeFileSync(composerBin, '#!/usr/bin/php\necho composer\n');
    chmodSync(composerBin, 0o755);

    const dir = installPhpShims(join(root, '.php-bin'), { phpBin, composerBins: [composerBin] });
    assert.equal(readlinkSync(join(dir, 'php')), phpBin);
    const wrapper = readFileSync(join(dir, 'composer'), 'utf8');
    assert.ok(wrapper.includes(phpBin));
    assert.ok(wrapper.includes(composerBin));

    const ran = spawnSync(join(dir, 'composer'), ['install'], { encoding: 'utf8' });
    assert.equal(ran.status, 0);
    assert.match(ran.stdout, new RegExp(`php:${composerBin}`));
  });
});

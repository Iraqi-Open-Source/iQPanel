/**
 * Action registry.
 *
 * Every agent action must be registered here before it can be called.
 * Unknown action names are rejected before any argument parsing.
 *
 * Entry shape:
 *   timeout   – ms before the action is aborted (default 60 000)
 *   validate  – throws if args are invalid
 *   run(args, emit) – returns a result value; may call emit(t, d) for streaming
 */

import * as pkg     from './actions/packages.js';
import * as svc     from './actions/systemd.js';
import * as nginx   from './actions/nginx.js';
import * as php     from './actions/php.js';
import * as dbact   from './actions/db.js';
import * as redis   from './actions/redis.js';
import * as docker  from './actions/docker.js';
import * as ssl     from './actions/ssl.js';
import * as fw      from './actions/firewall.js';
import * as files   from './actions/files.js';
import * as git     from './actions/git.js';
import * as exec    from './actions/exec.js';
import * as cron    from './actions/cron.js';
import * as users   from './actions/users.js';
import * as metrics from './actions/metrics.js';

/** @type {Map<string, {timeout:number, validate?:(a:any)=>void, run:(a:any,emit:Function)=>Promise<any>}>} */
export const registry = new Map([
  // packages
  ['pkg.install',           pkg.install],
  ['pkg.remove',            pkg.remove],
  ['pkg.list_installed',    pkg.listInstalled],

  // systemd
  ['svc.list',              svc.list],
  ['svc.start',             svc.start],
  ['svc.stop',              svc.stop],
  ['svc.restart',           svc.restart],
  ['svc.enable',            svc.enable],
  ['svc.disable',           svc.disable],
  ['svc.status',            svc.status],
  ['svc.journal',           svc.journal],
  ['svc.install_unit',      svc.installUnit],
  ['svc.remove_unit',       svc.removeUnit],

  // nginx
  ['nginx.test',            nginx.test],
  ['nginx.reload',          nginx.reload],
  ['nginx.write_vhost',     nginx.writeVhost],
  ['nginx.remove_vhost',    nginx.removeVhost],
  ['nginx.read_global',     nginx.readGlobal],

  // php
  ['php.install',           php.install],
  ['php.remove',            php.remove],
  ['php.installed_versions',php.installedVersions],
  ['php.set_default',       php.setDefault],
  ['php.write_pool',        php.writePool],
  ['php.remove_pool',       php.removePool],
  ['php.read_ini',          php.readIni],
  ['php.write_ini',         php.writeIni],

  // databases
  ['db.engines',            dbact.engines],
  ['db.create',             dbact.create],
  ['db.drop',               dbact.drop],
  ['db.dump',               dbact.dump],
  ['db.list',               dbact.list],

  // redis
  ['redis.status',          redis.status],
  ['redis.flush',           redis.flush],
  ['redis.info',            redis.info],

  // docker
  ['docker.status',         docker.status],
  ['docker.containers',     docker.containers],
  ['docker.container_action', docker.containerAction],
  ['docker.images',         docker.images],
  ['docker.compose',        docker.compose],
  ['docker.logs',           docker.logs],
  ['docker.prune',          docker.prune],

  // ssl/certbot
  ['ssl.issue',             ssl.issue],
  ['ssl.renew',             ssl.renew],
  ['ssl.revoke',            ssl.revoke],
  ['ssl.list',              ssl.list],

  // firewall/ufw
  ['fw.status',             fw.status],
  ['fw.allow',              fw.allow],
  ['fw.deny',               fw.deny],
  ['fw.delete',             fw.deleteRule],
  ['fw.listeners',          fw.listeners],

  // files (path-constrained)
  ['files.list',            files.list],
  ['files.read',            files.read],
  ['files.write',           files.write],
  ['files.mkdir',           files.mkdir],
  ['files.rename',          files.rename],
  ['files.delete',          files.deleteFile],
  ['files.stat',            files.stat],

  // git
  ['git.clone',             git.clone],
  ['git.pull',              git.pull],
  ['git.reset',             git.reset],
  ['git.log',               git.log],
  ['git.current_commit',    git.currentCommit],
  ['git.ls_remote',         git.lsRemote],
  ['git.keygen',            git.keygen],

  // exec (arbitrary shell scoped to site user)
  ['exec.run',              exec.run],
  ['exec.env_read',         exec.envRead],
  ['exec.env_write',        exec.envWrite],

  // cron
  ['cron.list',             cron.list],
  ['cron.write',            cron.write],

  // os users
  ['users.create_site_user', users.createSiteUser],
  ['users.remove_site_user', users.removeSiteUser],
  ['users.list_ssh_keys',    users.listSshKeys],
  ['users.add_ssh_key',      users.addSshKey],
  ['users.remove_ssh_key',   users.removeSshKey],

  // metrics
  ['metrics.snapshot',      metrics.snapshot],
  ['metrics.disk',          metrics.disk],
  ['metrics.processes',     metrics.processes],
]);

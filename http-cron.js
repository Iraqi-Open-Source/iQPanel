const { send, getSite, log, now, id, db, agentClient, body } = require('./http-shared');

function cronJobsForUser(user) {
  return db.rows(`SELECT cron_jobs.*, sites.slug AS slug FROM cron_jobs LEFT JOIN sites ON sites.id = cron_jobs.site_id WHERE cron_jobs.run_as_user=${db.sql(user)}`).map((job) => ({
    ...job,
    slug: job.slug || 'server',
    enabled: job.enabled !== 0,
  }));
}

async function syncCrontab(user) {
  await agentClient.invoke('writeCrontab', user, cronJobsForUser(user));
}

async function handleCron(request, response, pathname) {
  const patchMatch = pathname.match(/^\/api\/cron\/([^/]+)$/);
  if (patchMatch && request.method === 'PATCH') {
    const job = db.rows(`SELECT * FROM cron_jobs WHERE id=${db.sql(patchMatch[1])}`)[0];
    if (!job) {
      send(response, 404, { error: 'Cron job not found' });
      return true;
    }
    const input = await body(request);
    const schedule = input.schedule === undefined ? job.schedule : String(input.schedule);
    const commandText = input.command === undefined ? job.command : String(input.command);
    const enabled = input.enabled === undefined ? job.enabled : (input.enabled ? 1 : 0);
    if (!/^(\S+\s+){4}\S+$/.test(schedule)) throw new Error('Cron schedule must contain five fields');
    db.run(`UPDATE cron_jobs SET schedule=${db.sql(schedule)}, command=${db.sql(commandText)}, enabled=${enabled} WHERE id=${db.sql(job.id)}`);
    await syncCrontab(job.run_as_user);
    const updated = db.rows(`SELECT * FROM cron_jobs WHERE id=${db.sql(job.id)}`)[0];
    log('Cron job updated', updated.run_as_user, updated.command);
    send(response, 200, updated);
    return true;
  }
  if (patchMatch && request.method === 'DELETE') {
    const job = db.rows(`SELECT * FROM cron_jobs WHERE id=${db.sql(patchMatch[1])}`)[0];
    if (!job) {
      send(response, 404, { error: 'Cron job not found' });
      return true;
    }
    db.run(`DELETE FROM cron_jobs WHERE id=${db.sql(job.id)}`);
    await syncCrontab(job.run_as_user);
    log('Cron job deleted', job.run_as_user, job.command);
    send(response, 204, {});
    return true;
  }
  return false;
}

module.exports = { handleCron, syncCrontab, cronJobsForUser };

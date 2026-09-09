import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';

export default function CronPage() {
  const qc = useQueryClient();
  const { data: jobs = [] } = useQuery({ queryKey: ['cron'], queryFn: () => api.get('/api/cron') });
  const [schedule, setSchedule] = useState('');
  const [cmd, setCmd]           = useState('');
  const [loading, setLoading]   = useState(false);

  async function add() {
    setLoading(true);
    try {
      await api.post('/api/cron', { schedule, command: cmd });
      qc.invalidateQueries(['cron']);
      setSchedule(''); setCmd('');
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Cron Jobs</h1>
      <Card>
        <CardHeader><CardTitle>Add cron job</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Input className="w-36 font-mono text-xs" placeholder="* * * * *" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
          <Input className="flex-1 font-mono text-xs" placeholder="command" value={cmd} onChange={(e) => setCmd(e.target.value)} />
          <Button loading={loading} onClick={add}>Add</Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          {jobs.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No cron jobs.</p> : (
            <div className="divide-y divide-border">
              {jobs.map((j) => (
                <div key={j.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <code className="text-xs mr-2">{j.schedule}</code>
                    <span>{j.command}</span>
                    {j.run_as_user && <span className="ml-2 text-xs text-muted-foreground">as {j.run_as_user}</span>}
                  </div>
                  <Button size="sm" variant="destructive" onClick={async () => { await api.delete(`/api/cron/${j.id}`); qc.invalidateQueries(['cron']); }}>Remove</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

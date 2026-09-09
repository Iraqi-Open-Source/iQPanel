import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import Input from '../components/ui/Input.jsx';

export default function DatabasesPage() {
  const qc = useQueryClient();
  const { data: dbs = [] } = useQuery({
    queryKey: ['databases'],
    queryFn:  () => api.get('/api/databases'),
  });
  const [showForm, setShowForm] = useState(false);
  const [engine, setEngine] = useState('mysql');
  const [dbName, setDbName] = useState('');
  const [dbUser, setDbUser] = useState('');
  const [loading, setLoading] = useState(false);

  async function create() {
    setLoading(true);
    try {
      await api.post('/api/databases', { engine, db_name: dbName, db_user: dbUser });
      qc.invalidateQueries(['databases']);
      setShowForm(false); setDbName(''); setDbUser('');
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  }

  async function drop(db) {
    if (!confirm(`Drop ${db.db_name}? This is irreversible.`)) return;
    await api.delete(`/api/databases/${db.id}`);
    qc.invalidateQueries(['databases']);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Databases</h1>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : '+ New database'}</Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1">Engine</label>
                <select className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={engine} onChange={(e) => setEngine(e.target.value)}>
                  <option value="mysql">MySQL</option>
                  <option value="mariadb">MariaDB</option>
                  <option value="postgres">PostgreSQL</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Database name</label>
                <Input value={dbName} onChange={(e) => setDbName(e.target.value)} placeholder="myapp_production" />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Username</label>
                <Input value={dbUser} onChange={(e) => setDbUser(e.target.value)} placeholder="myapp_user" />
              </div>
            </div>
            <Button loading={loading} onClick={create}>Create</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {dbs.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No databases.</p> : (
            <div className="divide-y divide-border">
              {dbs.map((db) => (
                <div key={db.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="font-medium text-sm">{db.db_name}</p>
                    <p className="text-xs text-muted-foreground">{db.engine} · user: {db.db_user}</p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <Badge variant={db.granted ? 'success' : 'warning'}>{db.granted ? 'Granted' : 'Pending'}</Badge>
                    <Button size="sm" variant="destructive" onClick={() => drop(db)}>Drop</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

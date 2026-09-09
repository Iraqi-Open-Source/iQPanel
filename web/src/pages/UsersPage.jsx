import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Badge from '../components/ui/Badge.jsx';
import { timeAgo } from '../lib/utils.js';

export default function UsersPage() {
  const qc = useQueryClient();
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/api/users') });
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail]       = useState('');
  const [name, setName_]        = useState('');
  const [role, setRole]         = useState('operator');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);

  async function create() {
    setLoading(true);
    try {
      await api.post('/api/users', { email, name, role, password });
      qc.invalidateQueries(['users']);
      setShowForm(false); setEmail(''); setName_(''); setPassword('');
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  }

  async function deleteUser(id) {
    if (!confirm('Delete this user?')) return;
    await api.delete(`/api/users/${id}`);
    qc.invalidateQueries(['users']);
  }

  const roleVariant = { owner: 'default', admin: 'secondary', operator: 'secondary', readonly: 'outline' };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Users</h1>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : '+ Invite user'}</Button>
      </div>
      {showForm && (
        <Card>
          <CardContent className="p-6 grid grid-cols-2 gap-3">
            <div className="space-y-1"><label className="text-xs font-medium">Name</label><Input value={name} onChange={(e) => setName_(e.target.value)} /></div>
            <div className="space-y-1"><label className="text-xs font-medium">Email</label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Role</label>
              <select className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={role} onChange={(e) => setRole(e.target.value)}>
                {['owner','admin','operator','readonly'].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="space-y-1"><label className="text-xs font-medium">Password</label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <div className="col-span-2"><Button loading={loading} onClick={create}>Create user</Button></div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{u.name}</p>
                  <p className="text-xs text-muted-foreground">{u.email} · joined {timeAgo(u.created_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={roleVariant[u.role] ?? 'secondary'}>{u.role}</Badge>
                  <Button size="sm" variant="destructive" onClick={() => deleteUser(u.id)}>Remove</Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

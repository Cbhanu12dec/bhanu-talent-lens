import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';

export default function AdminPage() {
  const { data: stats } = useQuery({ queryKey: ['admin-stats'], queryFn: () => api.domains.adminStats() });
  const { data: users } = useQuery({ queryKey: ['admin-users'], queryFn: () => api.domains.adminUsers() });
  const navigate = useNavigate();

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1 className="page-title">Admin Console</h1><p className="page-sub">Restricted to admin role</p></div>
        <button className="btn btn-primary" onClick={() => navigate('/admin/domain-builder')}>+ Domain Builder</button>
      </div>

      <div className="grid-3" style={{ marginBottom: 24 }}>
        {[['Users', stats?.users], ['Domains', stats?.domains], ['Agent Runs', stats?.agentRuns], ['Resumes', stats?.resumes]].map(([label, val]) => (
          <div key={label as string} className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)' }}>{val ?? '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      <div className="section-card">
        <div className="section-card-head"><span className="card-title">Users</span></div>
        <table className="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Credits</th><th>Joined</th></tr></thead>
          <tbody>
            {(users || []).map((u: any) => (
              <tr key={u.id}>
                <td>{u.fullName}</td>
                <td style={{ color: 'var(--text-3)' }}>{u.email}</td>
                <td><span className={`badge badge-${u.role==='ADMIN'?'violet':'gray'}`}>{u.role}</span></td>
                <td>{u.credits}</td>
                <td style={{ color: 'var(--text-3)', fontSize: 12 }}>{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

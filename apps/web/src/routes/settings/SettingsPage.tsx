import React from 'react';
import { useAuthStore } from '../../stores';

export default function SettingsPage() {
  const user = useAuthStore(s => s.user);
  return (
    <div>
      <div className="page-header"><h1 className="page-title">Settings</h1></div>
      <div className="card" style={{ maxWidth: 480 }}>
        <div className="card-title" style={{ marginBottom: 14 }}>Account</div>
        <div className="form-group"><label className="form-label">Full name</label><input type="text" defaultValue={user?.fullName} /></div>
        <div className="form-group"><label className="form-label">Email</label><input type="email" defaultValue={user?.email} disabled /></div>
        <div className="form-group"><label className="form-label">Role</label><input type="text" value={user?.role} disabled /></div>
        <button className="btn btn-primary">Save changes</button>
      </div>
    </div>
  );
}

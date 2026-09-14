import React from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { ModulePage } from './ui/Primitives.jsx';
import ProfileSection from './settings/ProfileSection.jsx';
import AccountSection from './settings/AccountSection.jsx';
import AiSection from './settings/AiSection.jsx';
import ResumeSection from './settings/ResumeSection.jsx';
import NotificationsSection from './settings/NotificationsSection.jsx';
import DataSection from './settings/DataSection.jsx';
import BillingModule from './billing/BillingModule.jsx';

const I = d => (
  <svg className="set-nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

const ICONS = {
  profile: I(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
  account: I(<><circle cx="12" cy="12" r="9" /><path d="M9 12h6M12 9v6" /></>),
  resume: I(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>),
  ai: I(<><path d="m12 3 2.1 4.9L19 10l-4.9 2.1L12 17l-2.1-4.9L5 10l4.9-2.1Z" /><path d="M18 16.5 19 19l2.5 1-2.5 1L18 23.5 17 21l-2.5-1L17 19Z" /></>),
  bell: I(<><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>),
  data: I(<><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>),
  billing: I(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>)
};

const NAV = [
  {
    label: 'Account',
    items: [
      { key: 'profile', label: 'Profile', icon: ICONS.profile },
      { key: 'account', label: 'Account', icon: ICONS.account }
    ]
  },
  {
    label: 'Preferences',
    items: [
      { key: 'resume', label: 'Resume defaults', icon: ICONS.resume },
      { key: 'ai', label: 'AI preferences', icon: ICONS.ai },
      { key: 'notifications', label: 'Notifications', icon: ICONS.bell }
    ]
  },
  {
    label: 'Data & privacy',
    items: [{ key: 'data', label: 'Data & privacy', icon: ICONS.data }]
  },
  {
    label: 'Billing',
    items: [{ key: 'billing', label: 'Plan & billing', icon: ICONS.billing }]
  }
];

const VALID = new Set(NAV.flatMap(g => g.items.map(i => i.key)));

const COPY = {
  profile: ['Profile', 'Manage your personal information and the contact details used on your resumes.'],
  account: ['Account', 'Your sign-in email, password and connected accounts.'],
  resume: ['Resume defaults', 'Defaults applied to every resume you export.'],
  ai: ['AI preferences', 'Control how the agent writes, and see what it will never do.'],
  notifications: ['Notifications', 'Choose which updates appear in your notification menu.'],
  data: ['Data & privacy', 'Export your data, understand how it is used, or delete your account.'],
  billing: ['Plan & billing', 'Your credit balance, credit packs and purchase history.']
};

export default function SettingsView({ uid, state, sub, navigate, billingProps }) {
  const { user } = useAuth();
  const active = VALID.has(sub) ? sub : 'profile';
  const [title, description] = COPY[active];

  return (
    <ModulePage title="Settings" description="Manage your account, preferences and billing.">
      <div className="set-layout">
        <nav className="set-nav" aria-label="Settings sections">
          {NAV.map(group => (
            <div className="set-nav-group" key={group.label}>
              <div className="set-nav-label">{group.label}</div>
              {group.items.map(item => (
                <button
                  key={item.key}
                  type="button"
                  className={`set-nav-item${active === item.key ? ' is-active' : ''}`}
                  aria-current={active === item.key ? 'page' : undefined}
                  onClick={() => navigate('settings', item.key)}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="set-pane">
          <header className="pane-head">
            <h2 className="pane-title">{title}</h2>
            <p className="pane-desc">{description}</p>
          </header>

          {active === 'profile' && <ProfileSection uid={uid} state={state} user={user} />}
          {active === 'account' && <AccountSection user={user} />}
          {active === 'resume' && <ResumeSection uid={uid} state={state} />}
          {active === 'ai' && <AiSection uid={uid} state={state} />}
          {active === 'notifications' && <NotificationsSection uid={uid} state={state} />}
          {active === 'data' && <DataSection user={user} />}
          {/* Same component the Billing page renders — one source of truth. */}
          {active === 'billing' && <BillingModule {...billingProps} active onNavigate={navigate} />}
        </div>
      </div>
    </ModulePage>
  );
}

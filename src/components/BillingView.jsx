import React from 'react';
import { ModulePage } from './ui/Primitives.jsx';
import BillingModule from './billing/BillingModule.jsx';

export default function BillingView(props) {
  const { checkoutStatus } = props;
  return (
    <ModulePage
      title="Billing & credits"
      description="Manage your credit balance, buy more credits, and review your purchase history."
    >
      {checkoutStatus === 'success' && (
        <div className="success-box" style={{ marginBottom: 20 }}>
          Payment received — crediting your account now. This usually takes a few seconds and updates
          automatically. If the balance below hasn't moved after a minute, use "Refresh balance".
        </div>
      )}
      {checkoutStatus === 'cancel' && (
        <div className="error-box" style={{ marginBottom: 20 }}>Checkout was canceled — no charge was made.</div>
      )}
      <BillingModule {...props} />
    </ModulePage>
  );
}

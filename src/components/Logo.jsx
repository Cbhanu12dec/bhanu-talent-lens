import React from 'react';

// Single brand mark, used in the sidebar, topbar and on the login screen.
// The `id` suffix keeps gradient ids unique when several render at once.
export default function Logo({ size = 38, id = 'a' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" style={{ flex: 'none' }} aria-hidden="true">
      <defs>
        <linearGradient id={`rcp-bg-${id}`} x1="4" y1="2" x2="36" y2="38">
          <stop offset="0" stopColor="#57A4FF" />
          <stop offset="1" stopColor="#1170F0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="36" height="36" rx="11" fill={`url(#rcp-bg-${id})`} />

      {/* résumé page */}
      <rect x="11" y="9.5" width="17.5" height="21.5" rx="3" fill="#fff" />
      <path d="M14.5 15.5h7M14.5 19.5h9M14.5 23.5h6"
        stroke="#1170F0" strokeWidth="1.8" strokeLinecap="round" opacity=".5" />

      {/* spark, echoing the ✦ used for credits and the dashboard hero. Filled
          blue so it reads on the white page, white-outlined where it crosses
          onto the badge. */}
      <path d="M27 21.5 l1.9 4.3 l4.3 1.9 l-4.3 1.9 l-1.9 4.3 l-1.9 -4.3 l-4.3 -1.9 l4.3 -1.9 z"
        fill={`url(#rcp-bg-${id})`} stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

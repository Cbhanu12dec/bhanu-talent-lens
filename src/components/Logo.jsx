import React from 'react';

export default function Logo({ size = 38 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" style={{ flex: 'none' }}>
      <defs>
        <linearGradient id="tl-lg-purple" x1="0" y1="0" x2="40" y2="40">
          <stop offset="0" stopColor="#c4a8ff" />
          <stop offset="1" stopColor="#6d43d1" />
        </linearGradient>
        <linearGradient id="tl-lg-gold" x1="10" y1="4" x2="30" y2="18">
          <stop offset="0" stopColor="#ffe3a3" />
          <stop offset="1" stopColor="#d69a3c" />
        </linearGradient>
      </defs>
      <path d="M20 3 L33 8 V18 C33 27 27.5 33 20 36.5 C12.5 33 7 27 7 18 V8 Z" fill="rgba(139,92,246,0.12)" stroke="url(#tl-lg-purple)" strokeWidth="2" />
      <path d="M13 9.5 L15.6 13 L20 7 L24.4 13 L27 9.5 V14.5 H13 Z" fill="url(#tl-lg-gold)" />
      <circle cx="15.6" cy="10" r="1.05" fill="url(#tl-lg-gold)" />
      <circle cx="20" cy="8" r="1.05" fill="url(#tl-lg-gold)" />
      <circle cx="24.4" cy="10" r="1.05" fill="url(#tl-lg-gold)" />
      <path d="M20 19 L25.2 23.4 L20 30.5 L14.8 23.4 Z" fill="rgba(139,92,246,0.14)" stroke="url(#tl-lg-purple)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M17.2 21.2 L22.8 21.2 M16.2 23.4 L23.8 23.4" stroke="url(#tl-lg-purple)" strokeWidth="0.9" opacity="0.7" />
    </svg>
  );
}

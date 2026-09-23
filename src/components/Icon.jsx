import React from 'react';
const paths = {
  plus: <path d="M12 5v14M5 12h14"/>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  down: <path d="m6 9 6 6 6-6"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/></>,
  file: <><path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/></>,
  link: <><path d="m10 14 4-4m-5-2 2-2a4 4 0 0 1 6 6l-2 2m0 2-2 2a4 4 0 0 1-6-6l2-2"/></>,
  history: <><path d="M3 11a9 9 0 1 1 2 7M3 5v6h6M12 7v5l3 2"/></>,
  edit: <><path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z"/></>,
  download: <><path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
  alert: <><path d="m12 3 10 18H2zM12 9v5M12 17v.1"/></>,
  book: <><path d="M12 5v16M3 3h4a5 5 0 0 1 5 3 5 5 0 0 1 5-3h4v16h-4a5 5 0 0 0-5 2 5 5 0 0 0-5-2H3z"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  folder: <path d="M3 6h7l2 2h9v12H3z"/>,
  refresh: <><path d="M20 7a9 9 0 0 0-15 0L3 10m0-6v6h6m-5 7a9 9 0 0 0 15 0l2-3m0 6v-6h-6"/></>,
  print: <><path d="M7 8V3h10v5M7 17H3V8h18v9h-4M7 14h10v7H7z"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>
};
export default function Icon({name,size=18,...props}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]||paths.file}</svg>}

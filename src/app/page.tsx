"use client";

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Company {
  _id: string;
  name: string;
  urls: string[];
}

interface CWVRecord {
  _id: string;
  url: string;
  date: string;
  device: 'mobile' | 'desktop';
  fcp: number | null;
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  status: 'Pass' | 'Fail' | 'Unknown';
  isOriginFallback: boolean;
  originStatus?: 'Pass' | 'Fail' | 'Unknown';
}

const thresholds = {
  fcp:  { good: 1800,  ni: 3000 },
  lcp:  { good: 2500,  ni: 4000 },
  inp:  { good: 200,   ni: 500  },
  cls:  { good: 0.1,   ni: 0.25 },
};

type MetricKey = 'fcp' | 'lcp' | 'inp' | 'cls';
type Device = 'mobile' | 'desktop';
type StatusFilter = 'all' | 'pass' | 'fail';
type SourceFilter = 'all' | 'origin' | 'traffic';
type SortDirection = 'asc' | 'desc';

type SortKey =
  | 'url'
  | `${string}-${Device}-${MetricKey}`
  | `${string}-${Device}-status`;

function getMetricClass(key: MetricKey, val: number | null): string {
  if (val === null) return '';
  const t = thresholds[key];
  if (val <= t.good) return 'bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-450 font-medium';
  if (val <= t.ni)   return 'bg-amber-50/40 dark:bg-amber-950/20 text-amber-750 dark:text-amber-400 font-medium';
  return 'bg-rose-50/40 dark:bg-rose-950/20 text-rose-700 dark:text-rose-450 font-medium';
}

function statusOrder(status: CWVRecord['status'] | undefined): number {
  if (status === 'Pass') return 0;
  if (status === 'Fail') return 1;
  if (status === 'Unknown') return 2;
  return 3;
}

function formatPct(pass: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((pass / total) * 100)}%`;
}

interface GoodUrlStats {
  originPass: number;
  totalUrls: number;
  directPass: number;
  directTotal: number;
}

function computeGoodUrlStats(
  urls: string[],
  date: string,
  device: Device,
  dataMap: Record<string, Record<string, Record<string, CWVRecord>>>
): GoodUrlStats {
  let originPass = 0;
  let directPass = 0;
  let directTotal = 0;

  for (const url of urls) {
    const r = dataMap[url]?.[date]?.[device];
    if (r?.status === 'Pass') originPass++;
    if (!r || r.isOriginFallback) continue;
    directTotal++;
    if (r.status === 'Pass') directPass++;
  }

  return { originPass, totalUrls: urls.length, directPass, directTotal };
}

export default function Dashboard() {
  const [records, setRecords] = useState<CWVRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('');
  const [fetchStatus, setFetchStatus] = useState<string>('');
  const [deviceFilter, setDeviceFilter] = useState<'all' | 'mobile' | 'desktop'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; url: string } | null>(null);
  const [fetchingUrls, setFetchingUrls] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [isDark, setIsDark] = useState<boolean>(false);

  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    const initialDark = saved === 'dark';
    setIsDark(initialDark);
    if (initialDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const toggleTheme = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    if (newDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  // Derived data structures
  const activeCompany = useMemo(() => companies.find(c => c.name === activeTab), [companies, activeTab]);

  const dataMap = useMemo(() => {
    const map: Record<string, Record<string, Record<string, CWVRecord>>> = {};
    records.forEach(r => {
      if (!map[r.url]) map[r.url] = {};
      if (!map[r.url][r.date]) map[r.url][r.date] = {};
      map[r.url][r.date][r.device] = r;
    });
    return map;
  }, [records]);

  const uniqueDates = useMemo(() => {
    const dates = new Set(records.map(r => r.date));
    return Array.from(dates).sort().reverse();
  }, [records]);

  const latestDate = uniqueDates[0] ?? '';

  // Compute missing URLs for the latest date
  const computeMissingUrls = useCallback(() => {
    if (!latestDate) return [];
    return activeCompany?.urls.filter(url => {
      const mobile = dataMap[url]?.[latestDate]?.mobile;
      const desktop = dataMap[url]?.[latestDate]?.desktop;
      return !(mobile && desktop);
    }) ?? [];
  }, [activeCompany, latestDate, dataMap]);

  const missingUrls = useMemo(() => computeMissingUrls(), [computeMissingUrls]);

  const handleFetchMissing = async () => {
    if (!missingUrls.length) {
      setFetchStatus('No missing URLs');
      return;
    }
    await triggerFetch(missingUrls, false);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard');
      const data = await res.json();
      if (data.success) {
        setCompanies(data.companies);
        setRecords(data.records);
        setActiveTab(prev => {
          if (prev) return prev;
          return data.companies.length > 0 ? data.companies[0].name : '';
        });
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const closeMenu = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('click', closeMenu);
    return () => document.removeEventListener('click', closeMenu);
  }, []);

  const triggerFetch = async (urls?: string[], force = false) => {
    const label = urls?.length === 1
      ? `Fetching ${urls[0]}...`
      : force
        ? 'Re-fetching all URLs...'
        : 'Fetching missing URLs only...';

    setFetchStatus(label);
    if (urls?.length) {
      setFetchingUrls(prev => new Set([...prev, ...urls]));
    }

    try {
      await fetch('/api/fetch-cwv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, force }),
      });
      setFetchStatus(
        urls?.length === 1
          ? 'Fetch running — refresh in a few seconds'
          : force
            ? 'Re-fetch running in background — refresh when done'
            : 'Fetch running (skips today\'s existing data) — refresh when done'
      );
      setTimeout(() => fetchData(), urls?.length === 1 ? 5000 : 15000);
    } catch {
      setFetchStatus('Fetch failed to start');
    }

    setTimeout(() => {
      setFetchStatus('');
      if (urls?.length) {
        setFetchingUrls(prev => {
          const next = new Set(prev);
          urls.forEach(u => next.delete(u));
          return next;
        });
      }
    }, 10000);
  };

  const handleFetchCWV = () => triggerFetch(undefined, false);
  const handleFetchNewData = () => triggerFetch(undefined, true);

  const handleUrlContextMenu = (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, url });
  };

  const displayShortUrl = (u: string) => {
    try {
      const parsed = new URL(u);
      return `${parsed.pathname}${parsed.search}${parsed.hash}` || u;
    } catch {
      return u;
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const getSortValue = useCallback((url: string, key: SortKey): number | string => {
    if (key === 'url') return url;

    const match = key.match(/^(.+)-(mobile|desktop)-(fcp|lcp|cls|inp|status)$/);
    if (!match) return '';

    const [, date, device, field] = match;
    const r = dataMap[url]?.[date]?.[device as Device];
    if (!r) return field === 'status' ? 99 : Infinity;

    if (field === 'status') return statusOrder(r.status);
    return r[field as MetricKey] ?? Infinity;
  }, [dataMap]);

  const displayUrls = useMemo(() => {
    if (!activeCompany) return [];
    let urls = [...activeCompany.urls];

    if (latestDate) {
      if (statusFilter !== 'all') {
        urls = urls.filter(url => {
          return uniqueDates.some(date => {
            const mobileStatus = dataMap[url]?.[date]?.mobile?.status;
            const desktopStatus = dataMap[url]?.[date]?.desktop?.status;

            const mobileMatch = mobileStatus && (statusFilter === 'pass' ? mobileStatus === 'Pass' : mobileStatus !== 'Pass');
            const desktopMatch = desktopStatus && (statusFilter === 'pass' ? desktopStatus === 'Pass' : desktopStatus !== 'Pass');

            if (deviceFilter === 'mobile') return mobileMatch;
            if (deviceFilter === 'desktop') return desktopMatch;
            return mobileMatch || desktopMatch;
          });
        });
      }
      if (sourceFilter !== 'all') {
        urls = urls.filter(url => {
          const mobileR = dataMap[url]?.[latestDate]?.mobile;
          const desktopR = dataMap[url]?.[latestDate]?.desktop;

          const wantOrigin = sourceFilter === 'origin';
          if (deviceFilter === 'mobile') {
            return !!mobileR && (wantOrigin ? mobileR.isOriginFallback : !mobileR.isOriginFallback);
          }
          if (deviceFilter === 'desktop') {
            return !!desktopR && (wantOrigin ? desktopR.isOriginFallback : !desktopR.isOriginFallback);
          }

          const mobileOk = mobileR ? (wantOrigin ? mobileR.isOriginFallback : !mobileR.isOriginFallback) : true;
          const desktopOk = desktopR ? (wantOrigin ? desktopR.isOriginFallback : !desktopR.isOriginFallback) : true;
          return mobileOk && desktopOk;
        });
      }
    }

    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      urls = urls.filter(url => url.toLowerCase().includes(lowerQuery));
    }

    if (sortKey) {
      urls.sort((a, b) => {
        const av = getSortValue(a, sortKey);
        const bv = getSortValue(b, sortKey);
        const cmp = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) : (av as number) - (bv as number);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return urls;
  }, [activeCompany, statusFilter, sourceFilter, deviceFilter, latestDate, uniqueDates, dataMap, sortKey, sortDir, getSortValue, searchQuery]);

  const fmt = (val: number | null, key: MetricKey): string => {
    if (val === null) return '—';
    if (key === 'cls') return val.toFixed(3);
    return `${val}ms`;
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const METRICS: MetricKey[] = ['fcp', 'lcp', 'cls', 'inp'];
  const DEVICES: Device[] = ['mobile', 'desktop'];
  const COLS_PER_DEVICE = 5;
  const COLS_PER_DATE = DEVICES.length * COLS_PER_DEVICE;
  const METRIC_LABELS = ['FCP', 'LCP', 'CLS', 'INP', 'Status'] as const;

  const exportCSV = () => {
    const rows: string[] = [];
    const header = ['URL'];
    uniqueDates.forEach(date => {
      DEVICES.forEach(device => {
        const dStr = device === 'mobile' ? 'Mobile' : 'Desktop';
        METRIC_LABELS.forEach(label => {
          header.push(`${date} ${dStr} ${label}`);
        });
      });
    });
    rows.push(header.join(','));

    displayUrls.forEach(url => {
      const row = [`"${url}"`];
      uniqueDates.forEach(date => {
        DEVICES.forEach(device => {
          const r = dataMap[url]?.[date]?.[device];
          if (!r) {
            METRIC_LABELS.forEach(() => row.push('"—"'));
          } else {
            METRIC_LABELS.forEach(label => {
              if (label === 'Status') {
                const statusStr = r.status + (r.isOriginFallback ? ' (Origin)' : '');
                row.push(`"${statusStr}"`);
              } else {
                const key = label.toLowerCase() as MetricKey;
                row.push(`"${fmt(r[key], key)}"`);
              }
            });
          }
        });
      });
      rows.push(row.join(','));
    });

    const csvStr = rows.join('\n');
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.setAttribute('download', 'cwv_root_tracker.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-full min-h-screen p-6 md:px-8 md:py-6 flex flex-col gap-6 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50 transition-colors duration-200">
      <header className="flex flex-col md:flex-row md:justify-between md:items-center pb-4 border-b border-slate-200 dark:border-slate-800 gap-4 relative z-50">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent tracking-tight">CWV Tracker</h1>
        
        <button className="md:hidden flex items-center justify-center p-2 text-slate-700 dark:text-slate-200 ml-auto border border-slate-200 dark:border-slate-800 rounded-lg" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} aria-label="Toggle menu">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        </button>

        {isMobileMenuOpen && <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden" onClick={() => setIsMobileMenuOpen(false)} />}
        
        <div className={`flex items-center gap-3 transition-all duration-200 z-50 md:flex md:flex-row md:static md:w-auto md:p-0 md:bg-transparent md:backdrop-blur-none md:border-none md:shadow-none md:translate-y-0 md:opacity-100 ${isMobileMenuOpen ? 'fixed top-[70px] right-4 w-[250px] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex-col shadow-lg translate-y-0 opacity-100' : 'fixed pointer-events-none md:pointer-events-auto opacity-0 translate-y-[-20px] md:opacity-100 md:translate-y-0'}`}>
          {fetchStatus && <span className="text-xs text-amber-500 dark:text-amber-400 font-medium md:mr-2 text-center pb-2 md:pb-0 border-b border-slate-100 dark:border-slate-800 md:border-none w-full md:w-auto">{fetchStatus}</span>}

          <button
            className="w-full md:w-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold text-sm rounded-lg shadow-sm hover:shadow transition duration-200"
            onClick={toggleTheme}
            title="Toggle theme"
          >
            {isDark ? '☀️' : '🌙'}
          </button>

          <button className="w-full md:w-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold text-sm rounded-lg shadow-sm hover:shadow transition duration-200" onClick={() => { exportCSV(); setIsMobileMenuOpen(false); }} title="Export current view to CSV">
            Export CSV
          </button>
          <button className="w-full md:w-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold text-sm rounded-lg shadow-sm hover:shadow transition duration-200" onClick={() => { handleFetchMissing(); setIsMobileMenuOpen(false); }} title="Fetch only URLs missing CWV data for today">
            Fetch Missing
          </button>
          <button className="w-full md:w-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold text-sm rounded-lg shadow-sm hover:shadow transition duration-200" onClick={() => { fetchData(); setIsMobileMenuOpen(false); }}>
            Refresh
          </button>
          <button className="w-full md:w-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold text-sm rounded-lg shadow-sm hover:shadow transition duration-200" onClick={() => { handleFetchNewData(); setIsMobileMenuOpen(false); }} title="Fetch new data for today (force)">
            Fetch New Data
          </button>
          <button className="w-full md:w-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold text-sm rounded-lg shadow-sm hover:shadow transition duration-200" onClick={() => router.push('/dashboard')}>
            Go to Dashboard
          </button>
          <button className="w-full md:w-auto px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold text-sm rounded-lg shadow-sm hover:shadow transition duration-200" onClick={() => router.push('/query')}>
            Query Data
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-500 dark:text-slate-400">
          <div className="w-8 h-8 border-4 border-slate-200 dark:border-slate-700 border-t-blue-500 rounded-full animate-spin"></div>
          <span>Loading Dashboard...</span>
        </div>
      ) : companies.length === 0 ? (
        <div className="text-center py-20 text-slate-500 dark:text-slate-400">
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-2">No Data Found</h2>
          <p>Ensure MongoDB is connected and URLs are seeded.</p>
        </div>
      ) : (
        <div>
          <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800 pb-px mb-4">
            {companies.map(company => (
              <button
                key={company.name}
                className={`px-5 py-2.5 rounded-t-lg font-medium text-sm transition duration-200 whitespace-nowrap border-b-2 ${activeTab === company.name ? 'text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/20 border-blue-500' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100/50 dark:hover:bg-slate-800/40 border-transparent'}`}
                onClick={() => setActiveTab(company.name)}
              >
                {company.name}
              </button>
            ))}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-lg overflow-x-auto">
            {activeCompany && (
              <>
                <div className="flex pb-4 md:hidden">
                  <button className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold text-sm rounded-lg shadow-sm hover:shadow transition duration-200 flex items-center" onClick={() => setIsMobileFiltersOpen(true)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '6px'}}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                    Filters
                  </button>
                </div>

                {isMobileFiltersOpen && <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden" onClick={() => setIsMobileFiltersOpen(false)} />}
                
                <div className={`flex flex-wrap items-center gap-3 pb-3 mb-4 border-b border-slate-200 dark:border-slate-800 transition-all duration-200 ${isMobileFiltersOpen ? 'fixed top-[70px] left-0 w-full bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 rounded-b-2xl p-6 flex-col items-stretch shadow-2xl z-50 opacity-100 translate-y-0' : 'fixed pointer-events-none opacity-0 translate-y-[-20px] md:static md:flex md:flex-row md:p-0 md:shadow-none md:opacity-100 md:translate-y-0 md:pointer-events-auto'}`}>
                  <div className="flex justify-between items-center mb-4 md:hidden">
                    <h3 className="margin-0 font-bold text-lg text-slate-850 dark:text-slate-100">Filters</h3>
                    <button className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 text-2xl font-semibold" onClick={() => setIsMobileFiltersOpen(false)}>×</button>
                  </div>

                  <input
                    type="text"
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition duration-200 w-full md:w-52"
                    placeholder="Search URLs..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <span className="hidden md:inline text-slate-200 dark:text-slate-800 mx-1">|</span>

                  <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mt-2 md:mt-0">Device:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(['all', 'mobile', 'desktop'] as const).map(d => (
                      <button
                        key={d}
                        className={`px-3.5 py-1 rounded-full text-xs font-medium border transition duration-200 capitalize ${deviceFilter === d ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800' : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-350 border-slate-200 dark:border-slate-700'}`}
                        onClick={() => {setDeviceFilter(d); setIsMobileFiltersOpen(false);}}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <span className="hidden md:inline text-slate-200 dark:text-slate-800 mx-1">|</span>
                  <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mt-2 md:mt-0">Status:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(['all', 'pass', 'fail'] as StatusFilter[]).map(f => (
                      <button
                        key={f}
                        className={`px-3.5 py-1 rounded-full text-xs font-medium border transition duration-200 ${statusFilter === f ? (f === 'pass' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-250 dark:border-emerald-800' : f === 'fail' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 border-rose-250 dark:border-rose-800' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800') : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-350 border-slate-200 dark:border-slate-700'}`}
                        onClick={() => setStatusFilter(f)}
                      >
                        {f === 'all' ? 'All' : f === 'pass' ? 'Passed' : 'Failed'}
                      </button>
                    ))}
                  </div>
                  <span className="hidden md:inline text-slate-200 dark:text-slate-800 mx-1">|</span>
                  <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mt-2 md:mt-0">Source:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(['all', 'origin', 'traffic'] as SourceFilter[]).map(f => (
                      <button
                        key={f}
                        className={`px-3.5 py-1 rounded-full text-xs font-medium border transition duration-200 ${sourceFilter === f ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800' : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-350 border-slate-200 dark:border-slate-700'}`}
                        onClick={() => setSourceFilter(f)}
                      >
                        {f === 'all' ? 'All' : f === 'origin' ? 'Origin' : 'Traffic'}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-slate-400 dark:text-slate-550 md:ml-auto w-full md:w-auto text-center md:text-right mt-3 md:mt-0">
                    {displayUrls.length} / {activeCompany.urls.length} URLs
                    {latestDate ? ` · latest: ${latestDate}` : ''}
                  </span>
                  
                  {isMobileFiltersOpen && (
                    <button className="w-full px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-650 text-white font-semibold text-sm rounded-lg shadow-md mt-4" onClick={() => setIsMobileFiltersOpen(false)}>
                      Apply Filters
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800/80 rounded-xl max-h-[75vh] overflow-y-auto">
                  <table className="w-full border-collapse text-left text-sm text-slate-600 dark:text-slate-300">
                    <thead className="sticky top-0 z-20 bg-slate-50 dark:bg-slate-950">
                      <tr>
                        <th rowSpan={4} className="sticky left-0 z-30 border border-slate-200 dark:border-slate-800/80 p-3 text-center text-slate-500 dark:text-slate-400 font-semibold bg-slate-50 dark:bg-slate-900 w-12">#</th>
                        <th
                          rowSpan={4}
                          className="sticky left-12 z-30 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-3 text-slate-850 dark:text-slate-200 font-bold whitespace-nowrap min-w-[200px] text-left cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 select-none"
                          onClick={() => handleSort('url')}
                        >
                          URL{sortIndicator('url')}
                        </th>
                        {uniqueDates.map(date => (
                          <th key={date} colSpan={COLS_PER_DATE} className="border border-slate-200 dark:border-slate-800/80 p-3 text-center bg-blue-50 dark:bg-slate-900 text-blue-800 dark:text-blue-300 font-bold tracking-wide">
                            {date}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {uniqueDates.map(date =>
                          DEVICES.map(device => (
                            <th key={`${date}-${device}`} colSpan={COLS_PER_DEVICE} className="border border-slate-200 dark:border-slate-800/80 p-3 text-center bg-indigo-50 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-305 font-semibold">
                              {device === 'mobile' ? '📱 Mobile' : '🖥️ Desktop'}
                            </th>
                          ))
                        )}
                      </tr>
                      <tr>
                        {uniqueDates.map(date =>
                          DEVICES.map(device => {
                            const stats = computeGoodUrlStats(activeCompany.urls, date, device, dataMap);
                            return (
                              <th key={`${date}-${device}-stats`} colSpan={COLS_PER_DEVICE} className="border border-slate-200 dark:border-slate-800/80 p-2 bg-slate-50 dark:bg-slate-900 text-center font-normal">
                                <div className="flex justify-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                                  <span className="text-emerald-600 dark:text-emerald-450 font-medium">
                                    Good URL (Origin): {stats.originPass}/{stats.totalUrls}{' '}
                                    ({formatPct(stats.originPass, stats.totalUrls)})
                                  </span>
                                  <span className="text-slate-300 dark:text-slate-700">|</span>
                                  <span className="text-blue-600 dark:text-blue-450 font-medium">
                                    Good URL (Traffic): {stats.directPass}/{stats.directTotal}{' '}
                                    ({formatPct(stats.directPass, stats.directTotal)})
                                  </span>
                                </div>
                              </th>
                            );
                          })
                        )}
                      </tr>
                      <tr>
                        {uniqueDates.map(date =>
                          DEVICES.map(device =>
                            METRIC_LABELS.map(metric => {
                              const colKey: SortKey =
                                metric === 'Status'
                                  ? `${date}-${device}-status`
                                  : `${date}-${device}-${metric.toLowerCase() as MetricKey}`;
                              return (
                                <th
                                  key={`${date}-${device}-${metric}`}
                                  className="border border-slate-200 dark:border-slate-800/80 p-3 text-center text-slate-500 dark:text-slate-400 font-medium bg-slate-50 dark:bg-slate-900 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 select-none"
                                  onClick={() => handleSort(colKey)}
                                >
                                  {metric}{sortIndicator(colKey)}
                                </th>
                              );
                            })
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {displayUrls.map((url, i) => (
                        <tr
                          key={url}
                          className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition duration-150 ${fetchingUrls.has(url) ? 'opacity-65 bg-blue-50/10 dark:bg-blue-900/10' : ''}`}
                          onContextMenu={e => handleUrlContextMenu(e, url)}
                        >
                          <td className="sticky left-0 z-10 border border-slate-200 dark:border-slate-800/80 p-3 text-center text-slate-450 dark:text-slate-500 bg-slate-50 dark:bg-slate-900 w-12">{i + 1}</td>
                          <td className="sticky left-12 z-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-3 text-left font-medium text-slate-900 dark:text-slate-100 truncate max-w-[250px] md:max-w-[300px] cursor-help" title={`${url}\nRight-click to fetch`}>
                            {fetchingUrls.has(url) && <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-ping mr-2" />}
                            {displayShortUrl(url)}
                            {dataMap[url] && Object.values(dataMap[url]).some(d =>
                              d.mobile?.isOriginFallback || d.desktop?.isOriginFallback
                            ) && (
                              <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-900/40">Origin</span>
                            )}
                          </td>
                          {uniqueDates.map(date =>
                            DEVICES.map(device => {
                              const r = dataMap[url]?.[date]?.[device];
                              if (!r) {
                                return METRIC_LABELS.map((_, mi) => (
                                  <td key={`${date}-${device}-empty-${mi}`} className="border border-slate-200 dark:border-slate-800/80 p-3 text-center text-slate-350 dark:text-slate-650 bg-slate-50/10 dark:bg-slate-900/10">—</td>
                                ));
                              }
                              const statusClass =
                                r.status === 'Pass' ? 'bg-emerald-150/45 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-450 border-emerald-200 dark:border-emerald-900/40'
                                : r.status === 'Fail' ? 'bg-rose-150/45 dark:bg-rose-950/40 text-rose-700 dark:text-rose-450 border-rose-200 dark:border-rose-900/40'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700';
                              return METRIC_LABELS.map(label => {
                                if (label === 'Status') {
                                  return (
                                    <td key={`${date}-${device}-status`} className="border border-slate-200 dark:border-slate-800/80 p-3 text-center font-normal whitespace-nowrap">
                                      <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${statusClass}`}>{r.status}</span>
                                      {r.isOriginFallback && <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-105 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-900/30">Origin</span>}
                                    </td>
                                  );
                                }
                                const key = label.toLowerCase() as MetricKey;
                                const cls = getMetricClass(key, r[key]);
                                return (
                                  <td key={`${date}-${device}-${key}`} className={`border border-slate-200 dark:border-slate-800/80 p-3 text-center font-normal whitespace-nowrap tabular-nums ${cls}`}>
                                    {fmt(r[key], key)}
                                  </td>
                                );
                              });
                            })
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1.5 w-48"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="w-full text-left px-4 py-2 text-sm text-slate-750 dark:text-slate-200 hover:bg-slate-105 dark:hover:bg-slate-700 transition duration-150"
            onClick={() => {
              window.open(contextMenu.url, '_blank', 'noopener');
              setContextMenu(null);
            }}
          >
            Open URL
          </button>
          <button
            className="w-full text-left px-4 py-2 text-sm text-slate-750 dark:text-slate-200 hover:bg-slate-105 dark:hover:bg-slate-700 transition duration-150"
            onClick={() => {
              triggerFetch([contextMenu.url], true);
              setContextMenu(null);
            }}
          >
            Fetch CWV for this URL
          </button>
          <button
            className="w-full text-left px-4 py-2 text-sm text-slate-750 dark:text-slate-200 hover:bg-slate-105 dark:hover:bg-slate-700 transition duration-150"
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.url);
              setContextMenu(null);
            }}
          >
            Copy URL
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useEffect, useState, useMemo } from 'react';
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
  isOriginFallback?: boolean;
}

type Device = 'mobile' | 'desktop';
type DataMap = Record<string, Record<string, Record<Device, CWVRecord>>>;

function buildDataMap(records: CWVRecord[]): DataMap {
  const map: DataMap = {};
  records.forEach(r => {
    if (!map[r.url]) map[r.url] = {};
    if (!map[r.url][r.date]) map[r.url][r.date] = {} as Record<Device, CWVRecord>;
    map[r.url][r.date][r.device] = r;
  });
  return map;
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
  dataMap: DataMap
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

function formatStat(pass: number, total: number): string {
  if (total === 0) return '—';
  const pct = Math.round((pass / total) * 100);
  return `${pass}/${total} (${pct}%)`;
}

export default function Dashboard() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [records, setRecords] = useState<CWVRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDark, setIsDark] = useState<boolean>(false);

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

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard');
      const data = await res.json();
      if (data.success) {
        setCompanies(data.companies);
        setRecords(data.records);
      }
    } catch (e) {
      console.error('Dashboard fetch error', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const dataMap = useMemo(() => buildDataMap(records), [records]);

  const uniqueDates = useMemo(() => {
    const dates = new Set(records.map(r => r.date));
    return Array.from(dates).sort().reverse();
  }, [records]);

  const recentFailedInfo = useMemo(() => {
    if (uniqueDates.length < 1) return [];
    const axisCompany = companies.find(c => c.name.toLowerCase().includes('axis max life'));
    const axisUrls = axisCompany ? axisCompany.urls : [];

    return Object.keys(dataMap).reduce((acc, url) => {
      if (!axisUrls.includes(url)) return acc;
      const latestDate = uniqueDates[0];
      const latestDevices = dataMap[url]?.[latestDate] ?? {};
      const failingDevices = Object.entries(latestDevices)
        .filter(([, r]) => !(r?.status === 'Pass'))
        .map(([device]) => device as Device);
      const anyPassToday = Object.values(latestDevices).some(r => r?.status === 'Pass');
      if (anyPassToday) return acc;

      let transitionDate = '';
      for (let i = 0; i < uniqueDates.length - 1; i++) {
        const date = uniqueDates[i];
        const olderDate = uniqueDates[i + 1];
        const dev = dataMap[url]?.[date] ?? {};
        const olderDev = dataMap[url]?.[olderDate] ?? {};
        const hasPass = Object.values(dev).some(r => r?.status === 'Pass');
        const olderHasPass = Object.values(olderDev).some(r => r?.status === 'Pass');
        if (!hasPass && olderHasPass) {
          transitionDate = date;
          break;
        }
      }

      if (transitionDate && failingDevices.length > 0) {
        acc.push({ url, devices: failingDevices, date: transitionDate });
      }
      return acc;
    }, [] as { url: string; devices: Device[]; date: string }[]);
  }, [uniqueDates, dataMap, companies]);

  const DEVICES: Device[] = ['mobile', 'desktop'];

  const exportCSV = () => {
    const rows: string[] = [];
    const header = ['Company'];
    uniqueDates.forEach(date => {
      DEVICES.forEach(device => {
        const dStr = device === 'mobile' ? 'Mobile' : 'Desktop';
        header.push(`${date} ${dStr} Origin`);
        header.push(`${date} ${dStr} Traffic`);
      });
    });
    rows.push(header.join(','));

    companies.forEach(company => {
      const row = [`"${company.name}"`];
      uniqueDates.forEach(date => {
        DEVICES.forEach(device => {
          const stats = computeGoodUrlStats(company.urls, date, device, dataMap);
          row.push(`"${formatStat(stats.originPass, stats.totalUrls)}"`);
          row.push(`"${formatStat(stats.directPass, stats.directTotal)}"`);
        });
      });
      rows.push(row.join(','));
    });

    const csvStr = rows.join('\n');
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'cwv_dashboard.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-full min-h-screen p-6 md:px-8 md:py-6 flex flex-col gap-6 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50 transition-colors duration-200">
      <header className="flex flex-col md:flex-row md:justify-between md:items-center pb-4 border-b border-slate-200 dark:border-slate-800 gap-4">
        <div className="flex items-center gap-3">
          <button
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold text-sm rounded-lg shadow-sm hover:shadow transition duration-200"
            onClick={() => router.push('/')}
            title="Back to Home"
          >
            ← Back
          </button>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent tracking-tight">CWV Dashboard</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold text-sm rounded-lg shadow-sm hover:shadow transition duration-200 text-lg"
            onClick={toggleTheme}
            title="Toggle theme"
          >
            {isDark ? '☀️' : '🌙'}
          </button>
          <button className="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-650 hover:from-blue-600 hover:to-indigo-700 text-white font-semibold text-sm rounded-lg shadow-md hover:shadow-lg transition duration-200 transform hover:-translate-y-0.5 active:translate-y-0" onClick={exportCSV}>
            Export CSV
          </button>
          <button className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-850 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold text-sm rounded-lg shadow-sm hover:shadow transition duration-200" onClick={fetchData}>
            Refresh
          </button>
        </div>
      </header>
      <>
        {recentFailedInfo.length > 0 && (
          <div className="mt-2 bg-rose-50/20 dark:bg-rose-950/10 border border-rose-250 dark:border-rose-900/50 rounded-xl p-5 shadow-sm">
            <h2 className="text-lg font-bold text-rose-800 dark:text-rose-400 mb-3">Recently Failed URLs</h2>
            <ul className="list-none p-0 m-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {recentFailedInfo.map(item => (
                <li key={item.url} className="bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 px-4 py-2.5 rounded-lg border border-rose-200/50 dark:border-rose-900/40 text-sm break-all font-medium">
                  {item.url} ({item.devices.join(', ')}) – {item.date}
                </li>
              ))}
            </ul>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-500 dark:text-slate-400">
            <div className="w-8 h-8 border-4 border-slate-200 dark:border-slate-700 border-t-blue-500 rounded-full animate-spin" />
            <span>Loading Dashboard…</span>
          </div>
        ) : companies.length === 0 ? (
          <div className="text-center py-20 text-slate-500 dark:text-slate-400">
            <h2 className="text-xl font-bold text-slate-850 dark:text-slate-200 mb-2">No Data Found</h2>
            <p>Ensure MongoDB is connected and URLs are seeded.</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-lg overflow-x-auto">
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl max-h-[75vh] overflow-y-auto">
              <table className="w-full border-collapse text-left text-sm text-slate-600 dark:text-slate-350">
                <thead className="sticky top-0 z-20 bg-slate-50 dark:bg-slate-950">
                  <tr>
                    <th rowSpan={3} className="sticky left-0 z-30 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 text-slate-800 dark:text-slate-200 font-bold whitespace-nowrap min-w-[160px] text-left">Company</th>
                    {uniqueDates.map(date => (
                      <th key={date} colSpan={4} className="border border-slate-200 dark:border-slate-800 p-3 text-center bg-blue-50 dark:bg-slate-900 text-blue-800 dark:text-blue-300 font-bold tracking-wide">
                        {date}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {uniqueDates.map(date =>
                      DEVICES.map(device => (
                        <th key={`${date}-${device}`} colSpan={2} className="border border-slate-200 dark:border-slate-800 p-3 text-center bg-indigo-50 dark:bg-indigo-950 text-indigo-805 dark:text-indigo-305 font-semibold">
                          {device === 'mobile' ? 'Mobile' : 'Desktop'}
                        </th>
                      ))
                    )}
                  </tr>
                  <tr>
                    {uniqueDates.map(date =>
                      DEVICES.map(device => (
                        <React.Fragment key={`${date}-${device}`}>
                          <th className="border border-slate-200 dark:border-slate-800 p-3 text-center bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 font-semibold text-[11px] uppercase tracking-wider">Origin</th>
                          <th className="border border-slate-200 dark:border-slate-800 p-3 text-center bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 font-semibold text-[11px] uppercase tracking-wider">Traffic</th>
                        </React.Fragment>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {companies.map(company => (
                    <tr key={company._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition duration-150">
                      <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 text-left font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">{company.name}</td>
                      {uniqueDates.map(date =>
                        DEVICES.map(device => {
                          const stats = computeGoodUrlStats(company.urls, date, device, dataMap);
                          return (
                            <React.Fragment key={`${date}-${device}`}>
                              <td className="border border-slate-200 dark:border-slate-800 p-3 text-center text-slate-700 dark:text-slate-300 whitespace-nowrap tabular-nums">{formatStat(stats.originPass, stats.totalUrls)}</td>
                              <td className="border border-slate-200 dark:border-slate-800 p-3 text-center text-slate-700 dark:text-slate-300 whitespace-nowrap tabular-nums">{formatStat(stats.directPass, stats.directTotal)}</td>
                            </React.Fragment>
                          );
                        })
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>
    </div>
  );
}

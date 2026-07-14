"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Company {
  _id: string;
  name: string;
  urls: string[];
}

interface CWVRecord {
  url: string;
  date: string;
  device: string;
  fcp: number | null;
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  status: string;
  isOriginFallback: boolean;
}

export default function QueryPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [querying, setQuerying] = useState(false);
  const [isDark, setIsDark] = useState<boolean>(false);

  // Form State
  const [selectedCompanies, setSelectedCompanies] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [device, setDevice] = useState('all');
  const [source, setSource] = useState('all');
  const [status, setStatus] = useState('all');

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

  useEffect(() => {
    const fetchCompanies = async () => {
      try {
        const res = await fetch('/api/dashboard');
        const data = await res.json();
        if (data.success) {
          setCompanies(data.companies);
        }
      } catch (err) {
        console.error('Failed to load companies', err);
      }
      setLoading(false);
    };
    fetchCompanies();
  }, []);

  const toggleCompany = (name: string) => {
    const newSet = new Set(selectedCompanies);
    if (newSet.has(name)) newSet.delete(name);
    else newSet.add(name);
    setSelectedCompanies(newSet);
  };

  const handleQueryAndDownload = async () => {
    setQuerying(true);
    try {
      const payload = {
        companies: Array.from(selectedCompanies),
        startDate,
        endDate,
        device,
        source,
        status
      };

      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (data.success && data.records.length > 0) {
        downloadCSV(data.records);
      } else {
        alert('No records found for the selected query.');
      }
    } catch (err) {
      console.error('Query failed', err);
      alert('An error occurred while querying.');
    }
    setQuerying(false);
  };

  const downloadCSV = (records: CWVRecord[]) => {
    const header = ['URL', 'Date', 'Device', 'FCP', 'LCP', 'CLS', 'INP', 'Status', 'Is Origin'];
    const rows = [header.join(',')];

    records.forEach(r => {
      const row = [
        `"${r.url}"`,
        `"${r.date}"`,
        `"${r.device}"`,
        r.fcp !== null ? r.fcp : '—',
        r.lcp !== null ? r.lcp : '—',
        r.cls !== null ? r.cls : '—',
        r.inp !== null ? r.inp : '—',
        `"${r.status}"`,
        r.isOriginFallback ? 'Yes' : 'No'
      ];
      rows.push(row.join(','));
    });

    const csvStr = rows.join('\n');
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'cwv_query_results.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950">
        <div className="w-8 h-8 border-4 border-slate-200 dark:border-slate-700 border-t-blue-500 rounded-full animate-spin" />
        <span>Loading Query Interface...</span>
      </div>
    );
  }

  return (
    <div className="max-w-full min-h-screen p-6 md:px-8 md:py-6 flex flex-col gap-6 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50 transition-colors duration-200">
      <header className="flex flex-col md:flex-row md:justify-between md:items-center pb-4 border-b border-slate-200 dark:border-slate-800 gap-4">
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold text-sm rounded-lg shadow-sm hover:shadow transition duration-200" onClick={() => router.push('/')}>
            ← Back
          </button>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent tracking-tight">Data Query & Export</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-semibold text-sm rounded-lg shadow-sm hover:shadow transition duration-200 text-lg"
            onClick={toggleTheme}
            title="Toggle theme"
          >
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-lg flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Companies</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 bg-slate-50 dark:bg-slate-800 p-4 border border-slate-200 dark:border-slate-800 rounded-xl">
            {companies.map(c => (
              <label key={c._id} className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-355 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selectedCompanies.has(c.name)}
                  onChange={() => toggleCompany(c.name)}
                  className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 bg-white dark:bg-slate-800"
                />
                {c.name}
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500">Leave all unchecked to query all companies.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Start Date</h3>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition duration-200 w-full" />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">End Date</h3>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition duration-200 w-full" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Device</h3>
            <select value={device} onChange={e => setDevice(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition duration-200 w-full">
              <option value="all">All Devices</option>
              <option value="mobile">Mobile Only</option>
              <option value="desktop">Desktop Only</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Source</h3>
            <select value={source} onChange={e => setSource(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition duration-200 w-full">
              <option value="all">Origin & Traffic</option>
              <option value="origin">Origin Only</option>
              <option value="traffic">Traffic Only</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Status</h3>
            <select value={status} onChange={e => setStatus(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition duration-200 w-full">
              <option value="all">All Statuses</option>
              <option value="pass">Pass Only</option>
              <option value="fail">Fail Only</option>
              <option value="unknown">Unknown Only</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end mt-2">
          <button
            className="w-full md:w-auto px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-650 hover:from-blue-600 hover:to-indigo-700 text-white font-semibold text-sm rounded-lg shadow-md hover:shadow-lg transition duration-200 transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:pointer-events-none"
            onClick={handleQueryAndDownload}
            disabled={querying}
          >
            {querying ? 'Querying...' : 'Query & Download CSV'}
          </button>
        </div>
      </div>
    </div>
  );
}

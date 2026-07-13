import React from 'react';

interface Company {
  _id: string;
  name: string;
  urls: string[];
}

type Device = 'mobile' | 'desktop';

interface CWVRecord {
  _id: string;
  url: string;
  date: string;
  device: Device;
  fcp: number | null;
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  status: 'Pass' | 'Fail' | 'Unknown';
  isOriginFallback?: boolean;
}

type DataMap = Record<string, Record<string, Record<Device, CWVRecord>>>;

interface Props {
  company: Company;
  dates: string[];
  dataMap: DataMap;
}

export default function CompanyTable({ company, dates, dataMap }: Props) {
  return (
    <div className="p-8 bg-slate-100 dark:bg-slate-800 text-center text-slate-500 dark:text-slate-400 rounded-xl border border-slate-200 dark:border-slate-700/80 font-medium">
      <p>Company Table for {company.name} (placeholder)</p>
    </div>
  );
}

'use client';

import Select from './Select';

interface UpgradeOption {
  key: number;
  label: string;
  sublabel?: string;
}

interface UpgradeSelectProps {
  value: number;
  onChange: (value: number) => void;
  options: UpgradeOption[];
}

export default function UpgradeSelect({ value, onChange, options }: UpgradeSelectProps) {
  return (
    <Select
      value={value}
      onChange={onChange}
      options={options.map((o) => ({
        value: o.key,
        label: o.label,
        sublabel: o.sublabel ? `ilvl ${o.sublabel}` : undefined,
      }))}
    />
  );
}

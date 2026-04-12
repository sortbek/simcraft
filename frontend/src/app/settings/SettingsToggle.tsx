'use client';

interface SettingsToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
}

export default function SettingsToggle({ checked, onChange }: SettingsToggleProps) {
  return (
    <label className="relative inline-flex cursor-pointer items-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <div className="h-5 w-10 rounded-full bg-surface-container-highest after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-on-surface after:transition-all after:content-[''] peer-checked:bg-primary-container peer-checked:after:translate-x-full peer-checked:after:border-white" />
    </label>
  );
}

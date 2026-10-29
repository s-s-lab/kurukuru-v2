import { CalendarRange } from 'lucide-react';

export function BrandMark() {
  return (
    <span className="brand-mark" aria-label="Kurukuru">
      <span className="brand-icon" aria-hidden="true">
        <CalendarRange size={20} strokeWidth={2.2} />
      </span>
      <span>Kurukuru</span>
    </span>
  );
}


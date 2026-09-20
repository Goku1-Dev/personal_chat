import './Spinner.scss';

interface SpinnerProps {
  size?: number;
  label?: string;
}

export function Spinner({ size = 18, label }: SpinnerProps) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size }}
      role="status"
      aria-live="polite"
    >
      <span className="visually-hidden">{label ?? 'Loading'}</span>
    </span>
  );
}

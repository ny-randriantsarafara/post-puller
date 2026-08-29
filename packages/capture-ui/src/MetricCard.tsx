type MetricCardProps = {
  label: string;
  value: number | string;
};

export function MetricCard({ label, value }: MetricCardProps) {
  return (
    <div className="cui-metric">
      <div className="cui-metric__label">{label}</div>
      <div className="cui-metric__value">{value}</div>
    </div>
  );
}

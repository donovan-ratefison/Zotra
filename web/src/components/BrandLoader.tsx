// BrandLoader shows the turning Zotra loader of the brand kit, with an optional text.
export function BrandLoader({ size = 24, label }: { size?: number; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2">
      <img src="/zotra-loader-light.svg" alt="" aria-hidden="true" width={size} height={size} className="shrink-0 dark:hidden" />
      <img src="/zotra-loader-dark.svg" alt="" aria-hidden="true" width={size} height={size} className="hidden shrink-0 dark:block" />
      {label}
    </span>
  );
}

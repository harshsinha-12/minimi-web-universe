export function Cat({
  className = "",
  small = false,
}: {
  className?: string;
  small?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 100 90"
      className={className}
      width={small ? 32 : 100}
      height={small ? 29 : 90}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M25 70C9 73 6 56 15 47C6 65 20 68 29 62"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M26 67C20 51 24 33 38 27L38 9L52 21L66 20L80 9L82 31C96 45 91 70 78 74L34 75Z"
        fill="currentColor"
      />
      <path
        d="M47 42L51 44M70 42L66 44"
        stroke="var(--cat-eye, #f6f4ec)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M55 52Q59 55 63 52"
        stroke="var(--cat-eye, #f6f4ec)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

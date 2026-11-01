export default function Shield({ small = false }) {
  return (
    <span
      className={`shield ${small ? 'shield-small' : ''}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" fill="none">
        <path
          d="m16 3 10 4v8c0 7-10 14-10 14S6 22 6 15V7l10-4Z"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="m11 15 3 3 7-7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}
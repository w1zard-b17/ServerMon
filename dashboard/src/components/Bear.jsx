// the mascot. mood changes the eyes for empty and alert states

export default function Bear({ size = 34, mood = "calm", className = "" }) {
  const eye = mood === "sleepy" ? (
    <>
      <path d="M20.5 30.5q2.5 1.8 5 0" stroke="#07130d" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <path d="M38.5 30.5q2.5 1.8 5 0" stroke="#07130d" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </>
  ) : (
    <>
      <circle cx="23" cy="30" r="2.6" fill="#07130d" />
      <circle cx="41" cy="30" r="2.6" fill="#07130d" />
      <circle cx="23.9" cy="29.1" r="0.8" fill="#fff" />
      <circle cx="41.9" cy="29.1" r="0.8" fill="#fff" />
    </>
  );
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="ServerMon bear">
      <defs>
        <linearGradient id="bear-fur" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3be38f" />
          <stop offset="1" stopColor="#12b865" />
        </linearGradient>
      </defs>
      <circle cx="15" cy="15" r="9" fill="url(#bear-fur)" />
      <circle cx="49" cy="15" r="9" fill="url(#bear-fur)" />
      <circle cx="15" cy="15" r="4" fill="#0b3d24" />
      <circle cx="49" cy="15" r="4" fill="#0b3d24" />
      <path d="M32 10c14 0 24 9.5 24 23 0 13-10.5 21-24 21S8 46 8 33c0-13.5 10-23 24-23z" fill="url(#bear-fur)" />
      <ellipse cx="32" cy="41" rx="10.5" ry="8" fill="#c9f7de" />
      <path d="M28.4 37.2c0-1.5 1.6-2.4 3.6-2.4s3.6.9 3.6 2.4c0 1.6-1.9 3.3-3.6 3.3s-3.6-1.7-3.6-3.3z" fill="#07130d" />
      <path d="M29.5 43.5q2.5 2 5 0" stroke="#0b3d24" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {eye}
      {mood === "alert" && <circle cx="52" cy="46" r="5" fill="#ef5350" stroke="#fff" strokeWidth="1.5" />}
    </svg>
  );
}

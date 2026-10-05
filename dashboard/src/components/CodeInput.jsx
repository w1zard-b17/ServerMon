// six digit boxes, accepts paste, calls onComplete(code) when full

import { useEffect, useRef, useState } from "react";

export default function CodeInput({ onComplete, error, disabled, autoFocus = true }) {
  const [digits, setDigits] = useState(Array(6).fill(""));
  const refs = useRef([]);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  // clear after a failed attempt
  useEffect(() => {
    if (error) {
      setDigits(Array(6).fill(""));
      refs.current[0]?.focus();
    }
  }, [error]);

  const update = (next) => {
    setDigits(next);
    if (next.every((d) => d !== "")) onComplete(next.join(""));
  };

  const onChange = (i, value) => {
    const clean = value.replace(/\D/g, "");
    if (!clean) {
      const next = [...digits];
      next[i] = "";
      setDigits(next);
      return;
    }
    const next = [...digits];
    clean.split("").slice(0, 6 - i).forEach((d, k) => (next[i + k] = d));
    const focus = Math.min(i + clean.length, 5);
    refs.current[focus]?.focus();
    update(next);
  };

  const onKeyDown = (i, e) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
  };

  return (
    <div className={`code-boxes ${error ? "error" : ""}`} key={error ? String(error) : "ok"}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1}`}
          maxLength={6}
          disabled={disabled}
          onChange={(e) => onChange(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}

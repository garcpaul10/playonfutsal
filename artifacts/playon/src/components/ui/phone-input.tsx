import React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

interface PhoneInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "type"> {
  value: string;
  onChange: (formatted: string, raw: string) => void;
  className?: string;
}

export function PhoneInput({ value, onChange, className, ...props }: PhoneInputProps) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 10);
    const formatted = formatPhone(e.target.value);
    onChange(formatted, raw);
  }

  return (
    <Input
      {...props}
      type="tel"
      value={value}
      onChange={handleChange}
      className={cn(className)}
      placeholder={props.placeholder ?? "(555) 555-5555"}
    />
  );
}

import { useState } from "react";
import { DateInput } from "./DateInput.tsx";
import { inputClass } from "./FormField.tsx";

/**
 * Local date-time as "yyyy-mm-ddThh:mm" (what datetime-local used): the date typed in the Settings
 * format, the time with the browser's own time field. With `name` the form gets that string.
 */
export function DateTimeInput({
  value,
  onChange,
  name,
  required,
  ...rest
}: {
  value: string;
  onChange: (local: string) => void;
  name?: string;
  required?: boolean;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const [date, setDate] = useState(value.slice(0, 10));
  const [time, setTime] = useState(value.slice(11, 16));
  const emit = (d: string, t: string) => onChange(d ? `${d}T${t || "00:00"}` : "");
  return (
    <div className="flex gap-2">
      <DateInput
        {...rest}
        required={required}
        value={date}
        onChange={(d) => {
          setDate(d);
          emit(d, time);
        }}
        className={inputClass}
      />
      <input
        type="time"
        aria-label={name}
        required={required}
        value={time}
        onChange={(e) => {
          setTime(e.target.value);
          emit(date, e.target.value);
        }}
        className={`${inputClass} w-auto`}
      />
      {name && <input type="hidden" name={name} value={value} />}
    </div>
  );
}

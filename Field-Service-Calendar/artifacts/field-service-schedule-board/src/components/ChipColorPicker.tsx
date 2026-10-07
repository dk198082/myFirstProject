import { Label } from "@/components/ui/label";

export const PALETTE_SWATCHES = [
  "#93c5fd",
  "#6ee7b7",
  "#fcd34d",
  "#fda4af",
  "#c4b5fd",
  "#67e8f9",
  "#f0abfc",
  "#bef264",
  "#fdba74",
  "#5eead4",
  "#f9a8d4",
  "#a5b4fc",
  "#7dd3fc",
  "#fde047",
  "#fca5a5",
  "#d1d5db",
  "#fca5a5",
  "#fecdd3",
  "#ffe4e6",
];

interface ChipColorPickerProps {
  value: number | null;
  onChange: (index: number | null) => void;
}

export function ChipColorPicker({ value, onChange }: ChipColorPickerProps) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">
        Chip color <span className="font-normal">(optional)</span>
      </Label>
      <div className="flex flex-wrap gap-1 items-center">
        <button
          type="button"
          onClick={() => onChange(null)}
          title="Auto — match technician swimlane color"
          aria-label="Auto color"
          className={`w-5 h-5 rounded border-2 transition-all shrink-0 ${
            value === null
              ? "border-foreground ring-1 ring-foreground scale-110"
              : "border-border hover:border-foreground/50"
          }`}
          style={{
            background:
              "linear-gradient(135deg, #93c5fd 33%, #6ee7b7 33%, #6ee7b7 66%, #fcd34d 66%)",
          }}
        />
        {PALETTE_SWATCHES.map((color, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            title={`Colour ${i + 1}`}
            aria-label={`Colour option ${i + 1}`}
            className={`w-5 h-5 rounded border-2 transition-all shrink-0 ${
              value === i
                ? "border-foreground ring-1 ring-foreground scale-110"
                : "border-border hover:border-foreground/50"
            }`}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </div>
  );
}

import { describe, test, expect, afterEach, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { HoursProgress } from "./dashboard";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-15T10:00:00"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function getBar(container: HTMLElement) {
  return container.querySelector(".h-full") as HTMLElement | null;
}

function getWrapper(container: HTMLElement) {
  return container.querySelector("[title]") as HTMLElement | null;
}

describe("HoursProgress null/zero total behavior", () => {
  test("renders nothing when total is null", () => {
    const { container } = render(<HoursProgress consumed={5} total={null} />);
    expect(container.innerHTML).toBe("");
  });

  test("renders nothing when total is undefined", () => {
    const { container } = render(<HoursProgress consumed={5} total={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  test("renders nothing when total is zero", () => {
    const { container } = render(<HoursProgress consumed={5} total={0} />);
    expect(container.innerHTML).toBe("");
  });

  test("renders nothing when total is negative", () => {
    const { container } = render(<HoursProgress consumed={5} total={-4} />);
    expect(container.innerHTML).toBe("");
  });

  test("treats null consumed as zero", () => {
    const { container } = render(<HoursProgress consumed={null} total={10} />);
    const bar = getBar(container);
    expect(bar).not.toBeNull();
    expect(bar!.className).toContain("bg-emerald-500");
    expect(bar!.style.width).toBe("0%");
    expect(container.textContent).toMatch(/Posted Hours\s*0%/);
  });
});

describe("HoursProgress color: behind vs on-pace", () => {
  test("green when no expected pace is provided", () => {
    const { container } = render(<HoursProgress consumed={8.4} total={10} />);
    expect(getBar(container)!.className).toContain("bg-emerald-500");
  });

  test("green when consumed meets expected", () => {
    const { container } = render(<HoursProgress consumed={5} total={10} expected={5} />);
    expect(getBar(container)!.className).toContain("bg-emerald-500");
  });

  test("green when ahead of expected", () => {
    const { container } = render(<HoursProgress consumed={7} total={10} expected={5} />);
    expect(getBar(container)!.className).toContain("bg-emerald-500");
  });

  test("red when behind expected", () => {
    const { container } = render(<HoursProgress consumed={3} total={10} expected={5} />);
    expect(getBar(container)!.className).toContain("bg-red-500");
  });

  test("red when exactly 100% consumed but behind expected", () => {
    const { container } = render(<HoursProgress consumed={10} total={10} expected={15} />);
    expect(getBar(container)!.className).toContain("bg-red-500");
  });

  test("green when over-consumed but not behind expected", () => {
    const { container } = render(<HoursProgress consumed={15} total={10} expected={8} />);
    const bar = getBar(container)!;
    expect(bar.className).toContain("bg-emerald-500");
    expect(bar.style.width).toBe("100%");
    expect(container.textContent).toMatch(/Posted Hours\s*150%/);
  });
});

describe("HoursProgress overdue handling", () => {
  test("green when overdue but no expected pace", () => {
    const { container } = render(
      <HoursProgress consumed={1} total={10} endDate="2026-07-14" />,
    );
    expect(getBar(container)!.className).toContain("bg-emerald-500");
  });

  test("red when overdue and behind expected", () => {
    const { container } = render(
      <HoursProgress consumed={1} total={10} endDate="2026-07-14" expected={5} />,
    );
    expect(getBar(container)!.className).toContain("bg-red-500");
  });

  test("not red when end date is today and on pace", () => {
    const { container } = render(
      <HoursProgress consumed={5} total={10} endDate="2026-07-15" expected={5} />,
    );
    expect(getBar(container)!.className).toContain("bg-emerald-500");
  });

  test("not red when end date is in the future", () => {
    const { container } = render(
      <HoursProgress consumed={5} total={10} endDate="2026-07-20" expected={5} />,
    );
    expect(getBar(container)!.className).toContain("bg-emerald-500");
  });

  test("no overdue marking when end date is missing", () => {
    const { container } = render(<HoursProgress consumed={5} total={10} expected={5} />);
    expect(getBar(container)!.className).toContain("bg-emerald-500");
  });

  test("percent consumed text is shown on the card", () => {
    const { container } = render(<HoursProgress consumed={5.5} total={10} />);
    expect(container.textContent).toMatch(/Posted Hours\s*55%/);
  });
});

describe("HoursProgress expected-pace inline label", () => {
  test("shows Posted first, then Expected, then on-pace within threshold", () => {
    const { container } = render(
      <HoursProgress consumed={5} total={10} expected={4.98} />,
    );
    const text = container.textContent ?? "";
    expect(text.indexOf("Posted Hours")).toBeLessThan(text.indexOf("Target Hours"));
    expect(text).toMatch(/Posted Hours\s*50%/);
    expect(text).toMatch(/Target Hours\s*50%/);
    expect(text).toContain("On Schedule Target Hours");
  });

  test("shows behind when posted < expected", () => {
    const { container } = render(
      <HoursProgress consumed={3} total={10} expected={5} />,
    );
    expect(container.textContent).toMatch(/Posted Hours\s*30%/);
    expect(container.textContent).toMatch(/Target Hours\s*50%/);
    expect(container.textContent).toContain("2h 00m Behind Target Hours");
  });

  test("shows ahead when posted > expected and within total", () => {
    const { container } = render(
      <HoursProgress consumed={7} total={10} expected={5} />,
    );
    expect(container.textContent).toMatch(/Posted Hours\s*70%/);
    expect(container.textContent).toMatch(/Target Hours\s*50%/);
    expect(container.textContent).toContain("2h 00m Ahead Target Hours");
  });

  test("shows over expected when consumed exceeds 100% of total", () => {
    const { container } = render(
      <HoursProgress consumed={15} total={10} expected={5} />,
    );
    expect(container.textContent).toMatch(/Posted Hours\s*150%/);
    expect(container.textContent).toMatch(/Target Hours\s*50%/);
    expect(container.textContent).toContain("10h 00m Over Target Hours");
    expect(container.textContent).not.toContain("Ahead Target Hours");
  });

  test("omits Expected and delta line when expected is null", () => {
    const { container } = render(
      <HoursProgress consumed={5} total={10} expected={null} />,
    );
    expect(container.textContent).not.toContain("Target Hours");
    expect(container.textContent).not.toContain("Ahead Target Hours");
    expect(container.textContent).not.toContain("Behind Target Hours");
    expect(container.textContent).not.toContain("Over Target Hours");
    expect(container.textContent).toMatch(/Posted Hours\s*50%/);
  });
});

describe("HoursProgress expected-pace tick", () => {
  const getTick = (c: HTMLElement) =>
    c.querySelector('[data-testid="tick-expected-pace"]') as HTMLElement | null;

  test("no tick when expected is undefined", () => {
    const { container } = render(<HoursProgress consumed={5} total={10} />);
    expect(getTick(container)).toBeNull();
  });

  test("no tick when expected is null", () => {
    const { container } = render(<HoursProgress consumed={5} total={10} expected={null} />);
    expect(getTick(container)).toBeNull();
  });

  test("tick rendered at the expected percentage position", () => {
    const { container } = render(<HoursProgress consumed={2} total={10} expected={6} />);
    const tick = getTick(container);
    expect(tick).not.toBeNull();
    expect(tick!.style.left).toBe("calc(60% - 2px)");
  });

  test("tick position clamps to 100% when expected exceeds total", () => {
    const { container } = render(<HoursProgress consumed={2} total={10} expected={15} />);
    expect(getTick(container)!.style.left).toBe("calc(100% - 2px)");
  });

  test("tick shown at 0% when expected is zero (window not started)", () => {
    const { container } = render(<HoursProgress consumed={0} total={10} expected={0} />);
    expect(getTick(container)!.style.left).toBe("calc(0% - 2px)");
  });
});

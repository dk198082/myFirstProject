// A live board refetches within eight seconds of a successful mirror update.
export const BOARD_POLL_MS = 8_000;
export const SAVE_RECHECK_MS = [5_000, 12_000, 20_000] as const;
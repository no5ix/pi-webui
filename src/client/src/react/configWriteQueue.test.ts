import { describe, expect, it, vi } from "vitest";
import { createConfigWriteQueue } from "./configWriteQueue";

describe("config write queue", () => {
  it("merges concurrent field and plugin edits into the latest saved config", async () => {
    interface Config { host: string; port: number; plugins: Record<string, { enabled: boolean }> }
    let stored: Config = { host: "127.0.0.1", port: 8505, plugins: {} };
    const read = vi.fn(() => Promise.resolve({ ...stored, plugins: { ...stored.plugins } }));
    const write = vi.fn(async (_machine: string, config: Config) => {
      await Promise.resolve();
      stored = config;
      return { saved: true };
    });
    const save = createConfigWriteQueue(read, write);

    await Promise.all([
      save("local", config => ({ ...config, host: "0.0.0.0" })),
      save("local", config => ({ ...config, port: 8510 })),
      save("local", config => ({ ...config, plugins: { ...config.plugins, sample: { enabled: true } } })),
    ]);

    expect(stored).toEqual({ host: "0.0.0.0", port: 8510, plugins: { sample: { enabled: true } } });
    expect(read).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenCalledTimes(3);
  });
});

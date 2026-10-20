/// <reference lib="webworker" />
import { parseSchematic } from "./parser";
import { blockTransfers } from "./block-storage";
self.onmessage = (
  event: MessageEvent<{ buffer: ArrayBuffer; name: string }>,
) => {
  try {
    const s = parseSchematic(
      new Uint8Array(event.data.buffer),
      event.data.name,
      (progress, label) =>
        self.postMessage({ type: "progress", progress, label }),
    );
    self.postMessage({ type: "done", schematic: s }, blockTransfers(s.regions));
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "解析檔案失敗。",
    });
  }
};

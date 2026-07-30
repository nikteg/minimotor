import type { Game } from "../engine/app.js";

export interface CaptureApi {
  dataUrl(type?: string, quality?: number): string;
  blob(type?: string, quality?: number): Promise<Blob>;
  download(filename?: string, type?: string, quality?: number): void;
}

export function createCapture(game: Game): CaptureApi {
  const blob = (type = "image/png", quality?: number) =>
    new Promise<Blob>((resolve, reject) =>
      game.canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("Minimotor: canvas capture failed"))),
        type,
        quality,
      ),
    );
  return {
    dataUrl(type = "image/png", quality) {
      return game.canvas.toDataURL(type, quality);
    },
    blob,
    async download(filename = "capture.png", type = "image/png", quality) {
      const url = URL.createObjectURL(await blob(type, quality));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      queueMicrotask(() => URL.revokeObjectURL(url));
    },
  };
}

import type { App } from "../engine/app.js";
export interface CaptureApi {
    dataUrl(type?: string, quality?: number): string;
    blob(type?: string, quality?: number): Promise<Blob>;
    download(filename?: string, type?: string, quality?: number): void;
}
export declare function createCapture(app: App): CaptureApi;

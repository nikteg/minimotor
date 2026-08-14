export function createCapture(app) {
    const blob = (type = "image/png", quality) => new Promise((resolve, reject) => app.canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Minimotor: canvas capture failed"))), type, quality));
    return {
        dataUrl(type = "image/png", quality) {
            return app.canvas.toDataURL(type, quality);
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

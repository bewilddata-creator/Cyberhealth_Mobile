// Browser-only helpers for adding a pill photo. No app state kept here between calls.

// Opens a plain file input -- no `capture` attribute -- so an iPhone offers both "Take Photo"
// and the photo library, not just the camera. Resolves to the chosen File, or null if the
// picker was cancelled (relies on the standard "cancel" event that Chrome and recent Safari
// fire on <input type=file>; on a browser that lacks it the promise simply stays pending until
// a file is chosen, which is harmless -- the caller shows no spinner until it resolves).
export function pickImage() {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0";
    const done = file => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => done((input.files && input.files[0]) || null), { once: true });
    input.addEventListener("cancel", () => done(null), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

// Draws the picked file to a canvas at most maxSide px on the long side, and returns a JPEG
// data URL. Rejects with a plain message if the result is still too large to upload.
export function shrinkToDataUrl(file, maxSide = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const padding = (base64.match(/=+$/) || [""])[0].length;
      const bytes = Math.floor((base64.length * 3) / 4) - padding;
      if (bytes > 6 * 1024 * 1024) return reject(new Error("That photo is too large. Try again."));
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That photo could not be read. Try again."));
    };
    img.src = url;
  });
}

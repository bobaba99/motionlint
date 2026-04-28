import sharp from "sharp";

export interface CompressOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: "png" | "jpeg" | "webp";
}

export async function compressForLLM(
  buffer: Buffer,
  opts: CompressOptions = {},
): Promise<{ data: string; mediaType: string }> {
  const maxWidth = opts.maxWidth ?? 1280;
  const maxHeight = opts.maxHeight ?? 8000;
  const format = opts.format ?? "jpeg";

  let pipeline = sharp(buffer, { unlimited: true }).resize({
    width: maxWidth,
    height: maxHeight,
    fit: "inside",
    withoutEnlargement: true,
  });

  if (format === "jpeg") {
    pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } }).jpeg({
      quality: opts.quality ?? 85,
      mozjpeg: true,
    });
  } else if (format === "webp") {
    pipeline = pipeline.webp({ quality: opts.quality ?? 85 });
  } else {
    pipeline = pipeline.png({ compressionLevel: 9 });
  }

  const compressed = await pipeline.toBuffer();
  const mediaType =
    format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
  return { data: compressed.toString("base64"), mediaType };
}

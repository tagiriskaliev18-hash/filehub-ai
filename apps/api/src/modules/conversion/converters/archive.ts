import JSZip from "jszip";

export async function wrapInZip(input: Buffer, originalName: string): Promise<{ data: Buffer; mimeType: string }> {
  const zip = new JSZip();
  zip.file(originalName, input);
  const data = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  return { data, mimeType: "application/zip" };
}

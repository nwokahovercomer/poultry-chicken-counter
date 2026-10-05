import * as ImageManipulator from "expo-image-manipulator";

const MAX_WIDTH = 1600;

/**
 * Shrinks a phone photo (often 4000px+, several MB) to at most 1600px wide
 * and re-encodes it as JPEG, returning base64. Smaller uploads are much
 * more reliable on mobile networks. Images already narrower than
 * MAX_WIDTH are re-encoded but not upscaled.
 */
export async function prepareImage(uri: string, width?: number): Promise<string> {
  const actions: ImageManipulator.Action[] =
    width && width > MAX_WIDTH ? [{ resize: { width: MAX_WIDTH } }] : [];

  const out = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: 0.8,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });

  if (!out.base64) throw new Error("Could not encode the image.");
  return out.base64;
}

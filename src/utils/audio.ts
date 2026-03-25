import { XAI_VOICE_OPTIONS } from "../constants";

export function encodePcm16Base64(input: Float32Array) {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function decodeBase64Bytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function pcm16BytesToFloat32(bytes: Uint8Array) {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const floats = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < sampleCount; index += 1) {
    floats[index] = view.getInt16(index * 2, true) / 0x8000;
  }
  return floats;
}

export function normalizeVoiceId(value?: string | null) {
  const trimmed = value?.trim();
  const normalized = trimmed ? trimmed.toLowerCase() : "eve";
  return XAI_VOICE_OPTIONS.some((voice) => voice.id === normalized) ? normalized : "eve";
}

export async function requestMicrophoneStream() {
  if (navigator.mediaDevices?.getUserMedia) {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  }

  const legacyGetUserMedia =
    (navigator as Navigator & {
      getUserMedia?: (
        constraints: MediaStreamConstraints,
        onSuccess: (stream: MediaStream) => void,
        onError: (error: Error) => void,
      ) => void;
      webkitGetUserMedia?: (
        constraints: MediaStreamConstraints,
        onSuccess: (stream: MediaStream) => void,
        onError: (error: Error) => void,
      ) => void;
    }).webkitGetUserMedia ??
    (navigator as Navigator & {
      getUserMedia?: (
        constraints: MediaStreamConstraints,
        onSuccess: (stream: MediaStream) => void,
        onError: (error: Error) => void,
      ) => void;
    }).getUserMedia;

  if (!legacyGetUserMedia) {
    throw new Error("Microphone capture is unavailable in this runtime.");
  }

  return new Promise<MediaStream>((resolve, reject) => {
    legacyGetUserMedia.call(
      navigator,
      {
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      },
      resolve,
      reject,
    );
  });
}

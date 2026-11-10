// 既存の画面から、生徒側AIを使うための共通入口。
import {
  createStudentAI,
  MODELS,
  compatible
} from './student-ai-core.js';

export { MODELS };

export const WEBLLM_URL = new URL(
  './vendor/webllm.module.js',
  import.meta.url
).href;

const api = createStudentAI({
  loadRuntime: () => import(WEBLLM_URL)
});

export const cachedModels = api.cachedModels;
export const cachedModel = api.cachedModel;
export const prepare = api.prepare;
export const isReady = api.isReady;
export const loadedModel = api.loadedModel;
export const isCapable = api.isCapable;
export const generate = api.generate;
export const generateJSON = api.generateJSON;
export const subscribe = api.subscribe;
export const unload = api.unload;

export const FALLBACK = 'gemma4-e2b';

export const fallbackFor = (key, device) =>
  key !== 'gemma4-e2b' && device?.webgpu
    ? 'gemma4-e2b'
    : null;

export const defaultModel = device =>
  device?.f16 ? 'gemma4-e2b-f16' : 'gemma4-e2b';

export const canRun = compatible;

// WebGPUと16ビット演算への対応を確認する。
export async function checkDevice() {
  if (!globalThis.navigator?.gpu) {
    return { webgpu: false, f16: false };
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();

    return {
      webgpu: Boolean(adapter),
      f16: Boolean(adapter?.features.has('shader-f16'))
    };
  } catch {
    return { webgpu: false, f16: false };
  }
}

export async function keepStorage() {
  try {
    return await navigator.storage?.persist?.() ?? false;
  } catch {
    return false;
  }
}

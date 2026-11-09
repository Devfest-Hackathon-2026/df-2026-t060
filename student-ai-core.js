// 生徒端末AIの準備を制御する。
// 先生PCのOllamaとは別の、ブラウザ内WebLLM。
// 保存済みはロードだけ。未保存はボタンを押すまで取得しない。

export const MODELS = [
  {
    key: 'gemma4-e2b-f16',
    id: 'gemma-4-E2B-it-q4f16_1-MLC',
    label: 'Gemma 4 E2B',
    needsF16: true,
    main: true,
    sizeLabel: '約2.7GB（目安）'
  },
  {
    key: 'gemma4-e2b',
    id: 'gemma-4-E2B-it-q4f32_1-MLC',
    label: 'Gemma 4 E2B（32ビット版）',
    needsF16: false,
    main: true,
    sizeLabel: '約2.7GB（目安）'
  },
  {
    key: 'gemma3-1b',
    id: 'gemma3-1b-it-q4f16_1-MLC',
    label: 'Gemma 3 1B',
    needsF16: true,
    main: false,
    sizeLabel: '数百MB程度（目安）'
  }
];

// 端末がモデルを実行できるか調べる。
export const compatible = (model, device) =>
  device?.webgpu === true && (!model.needsF16 || device.f16);

function modelRoot(url) {
  let result = url.endsWith('/') ? url : url + '/';

  if (!/.+\/resolve\/.+\//.test(result)) {
    result += 'resolve/main/';
  }

  return new URL(result).href;
}

// IndexedDBの保存済みファイルを読む。
// この関数ではダウンロードしない。
function readIDB(scope, url, countOnly = false) {
  return new Promise(resolve => {
    if (!globalThis.indexedDB) return resolve(undefined);

    const request = indexedDB.open(scope);
    let settled = false;

    const finish = value => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    request.onupgradeneeded = () => {
      request.transaction.abort();
    };

    request.onerror = () => finish(undefined);

    request.onsuccess = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains('urls')) {
        database.close();
        finish(undefined);
        return;
      }

      const transaction = database.transaction('urls', 'readonly');
      const store = transaction.objectStore('urls');
      const result = countOnly ? store.count(url) : store.get(url);

      result.onsuccess = () => {
        finish(countOnly ? result.result > 0 : result.result?.data);
      };

      result.onerror = () => finish(undefined);
      transaction.oncomplete = () => database.close();

      transaction.onabort = () => {
        database.close();
        finish(undefined);
      };
    };
  });
}

async function hasStored(scope, url, backend) {
  if (backend === 'indexeddb') {
    return Boolean(await readIDB(scope, url, true));
  }

  if (!globalThis.caches) return false;

  return Boolean(await (await caches.open(scope)).match(url));
}

async function readStoredJSON(scope, url, backend) {
  if (backend === 'indexeddb') {
    const value = await readIDB(scope, url);

    if (value == null) return null;

    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      return JSON.parse(new TextDecoder().decode(value));
    }

    return typeof value === 'string' ? JSON.parse(value) : value;
  }

  const response = globalThis.caches
    ? await (await caches.open(scope)).match(url)
    : null;

  return response ? await response.json() : null;
}

export function createStudentAI({
  loadRuntime,
  hasAsset = hasStored,
  readJSON = readStoredJSON
} = {}) {
  let engine = null;
  let loaded = null;
  let preparing = null;
  let runtimePromise = null;
  let queue = Promise.resolve();

  const listeners = new Set();

  const runtime = () => runtimePromise ??= (
    Promise.resolve().then(loadRuntime).catch(error => {
      runtimePromise = null;
      throw error;
    })
  );

  const emit = () => {
    for (const callback of listeners) {
      try {
        callback();
      } catch {}
    }
  };

  // 重みだけでなく、設定・文字変換・WASMまで保存済みか確認する。
  async function inspectOne(model, device, webllm, backend) {
    const appConfig = {
      ...webllm.prebuiltAppConfig,
      cacheBackend: backend
    };

    const record = appConfig.model_list.find(
      item => item.model_id === model.id
    );

    const info = {
      ...model,
      backend,
      compatible: compatible(model, device),
      weights: false,
      complete: false,
      missing: []
    };

    if (!record) {
      return {
        ...info,
        reason: 'この版のWebLLMにモデルの登録がありません'
      };
    }

    try {
      info.weights = await webllm.hasModelInCache(model.id, appConfig);

      if (!info.weights) return info;

      const root = modelRoot(record.model);
      const configURL = new URL('mlc-chat-config.json', root).href;

      const config = await readJSON(
        'webllm/config', configURL, backend
      );

      if (!config) info.missing.push('設定ファイル');

      if (!await hasAsset('webllm/wasm', record.model_lib, backend)) {
        info.missing.push('実行用WASM');
      }

      if (record.model_manifest) {
        const manifestURL = new URL(
          record.model_manifest, root
        ).href;

        if (!await hasAsset('webllm/config', manifestURL, backend)) {
          info.missing.push('モデルの定義');
        }
      }

      const tokenizer = config?.tokenizer_files?.includes('tokenizer.json')
        ? 'tokenizer.json'
        : config?.tokenizer_files?.includes('tokenizer.model')
          ? 'tokenizer.model'
          : null;

      if (
        !tokenizer ||
        !await hasAsset(
          'webllm/model',
          new URL(tokenizer, root).href,
          backend
        )
      ) {
        info.missing.push('文字変換ファイル');
      }

      info.complete = info.missing.length === 0;
    } catch (error) {
      info.reason = '保存領域を確認できません: ' + error.message;
    }

    return info;
  }

  async function cachedModels(device) {
    const webllm = await runtime();
    const results = [];

    for (const model of MODELS) {
      const cache = await inspectOne(
        model, device, webllm, 'cache'
      );

      const idb = await inspectOne(
        model, device, webllm, 'indexeddb'
      );

      // 同じモデルが両方にあれば、一式がそろっている保存先を優先。
      results.push(
        [cache, idb].find(item => item.complete) ??
        [cache, idb].find(item => item.weights) ??
        cache
      );
    }

    return results;
  }

  // allowDownload=falseが標準。保存済みロードで勝手に取得しない。
  function prepare(
    key,
    onProgress,
    {
      allowDownload = false,
      device = { webgpu: true, f16: true }
    } = {}
  ) {
    if (engine && loaded?.key === key) return Promise.resolve();

    if (preparing) {
      return preparing.key === key
        ? preparing.promise
        : Promise.reject(
            new Error('別のモデルを準備中です。終わってから切り替えてください')
          );
    }

    const model = MODELS.find(item => item.key === key);

    if (!model) {
      return Promise.reject(new Error('このモデルは登録されていません'));
    }

    if (!compatible(model, device)) {
      return Promise.reject(
        new Error('この端末では選んだモデルを動かせません')
      );
    }

    const promise = (async () => {
      const webllm = await runtime();

      const saved = (await cachedModels(device)).find(
        item => item.key === key
      );

      if (!saved.complete && !allowDownload) {
        throw new Error(
          saved.weights
            ? '保存済みの重みはありますが、' +
              saved.missing.join('・') +
              'が不足しています。自動ダウンロードはしません。'
            : 'この配信元にモデル一式が保存されていません。自動ダウンロードはしません。'
        );
      }

      if (
        !allowDownload &&
        typeof webllm.setInquiryCacheOnly !== 'function'
      ) {
        throw new Error(
          'キャッシュ限定の読み込みに対応した同梱ファイルへ更新してください'
        );
      }

      const appConfig = {
        ...webllm.prebuiltAppConfig,
        cacheBackend: saved.backend
      };

      // 実行中の生成が終わってから、モデルを切り替える。
      await queue;

      if (engine) {
        await engine.unload();
        engine = null;
        loaded = null;
        emit();
      }

      let next;

      try {
        webllm.setInquiryCacheOnly?.(!allowDownload);

        next = new webllm.MLCEngine({
          appConfig,
          initProgressCallback: onProgress
        });

        await next.reload(model.id, model.chatOpts);

        engine = next;
        loaded = {
          ...model,
          backend: saved.backend,
          fromCache: saved.complete
        };

        emit();
      } catch (error) {
        await next?.unload?.().catch(() => {});
        throw error;
      } finally {
        webllm.setInquiryCacheOnly?.(false);
      }
    })().finally(() => {
      preparing = null;
    });

    preparing = { key, promise };
    return promise;
  }

  // 同じモデルへ同時に複数の生成を依頼しない。
  const serial = callback => {
    const promise = queue.then(callback);
    queue = promise.catch(() => {});
    return promise;
  };

  async function generate(prompt, maxTokens = 160, system = null) {
    return serial(async () => {
      if (!engine) {
        throw new Error('生徒側AIがまだ準備できていません');
      }

      const start = performance.now();
      await engine.resetChat?.();

      const messages = system
        ? [
            { role: 'system', content: system },
            { role: 'user', content: prompt }
          ]
        : [{ role: 'user', content: prompt }];

      const response = await engine.chat.completions.create({
        messages,
        temperature: 0,
        max_tokens: maxTokens
      });

      return {
        text: response.choices?.[0]?.message?.content ?? '',
        ms: Math.round(performance.now() - start)
      };
    });
  }

  async function generateJSON(
    prompt,
    schema,
    maxTokens = 400,
    system = null
  ) {
    return serial(async () => {
      if (!engine) {
        throw new Error('生徒側AIがまだ準備できていません');
      }

      const start = performance.now();
      await engine.resetChat?.();

      const messages = system
        ? [
            { role: 'system', content: system },
            { role: 'user', content: prompt }
          ]
        : [{ role: 'user', content: prompt }];

      const response = await engine.chat.completions.create({
        messages,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: {
          type: 'json_object',
          schema: JSON.stringify(schema)
        }
      });

      const text = response.choices?.[0]?.message?.content ?? '';
      let json = null;

      try {
        json = JSON.parse(text);
      } catch {}

      return {
        text,
        json,
        ms: Math.round(performance.now() - start)
      };
    });
  }

  return {
    cachedModels,
    prepare,
    generate,
    generateJSON,

    isReady: () => Boolean(engine),
    loadedModel: () => loaded,
    isCapable: () => Boolean(loaded?.main),

    cachedModel: async device => (
      await cachedModels(device)
    ).find(item => item.compatible && item.complete)?.key ?? null,

    subscribe: callback => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    unload: async () => {
      await engine?.unload();
      engine = null;
      loaded = null;
      emit();
    }
  };
}

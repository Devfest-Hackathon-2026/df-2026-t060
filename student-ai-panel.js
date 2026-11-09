// モデルの保存状態・選択・準備状況を表示する。
import { el } from './common.js';

export function mountStudentAI(
  host,
  ai,
  { onChange = () => {} } = {}
) {
  let device = { webgpu: false, f16: false };
  let saved = [];
  let busy = false;

  const show = (kind, ...children) => {
    host.hidden = false;
    host.className = `aibanner ${kind}`;
    host.replaceChildren(...children);
  };

  const note = () => el(
    'p',
    { class: 'small' },
    `保存先：${location.origin}。以前と同じブラウザ・配信元で開くと、保存済みモデルを使えます。`
  );

  async function inspect() {
    saved = await ai.cachedModels(device);
    return saved;
  }

  function choices(message = '') {
    const select = el(
      'select',
      { 'aria-label': '生徒側AIのモデル' },
      ...saved.filter(model => model.compatible).map(model =>
        el(
          'option',
          { value: model.key },
          `${model.label}：${
            model.complete
              ? '保存済み'
              : model.weights
                ? '一部ファイルが不足'
                : '未保存'
          } / ${model.sizeLabel}`
        )
      )
    );

    const msg = el(
      'p',
      { role: 'status', class: 'small' },
      message
    );

    const button = el(
      'button',
      {
        type: 'button',
        class: 'ghost small',
        'data-action': 'prepare-student-ai'
      }
    );

    const describe = () => {
      const model = saved.find(item => item.key === select.value);
      button.disabled = !model;

      button.textContent = model?.complete
        ? '保存済みのモデルを読み込む'
        : model?.weights
          ? '不足しているファイルを準備する'
          : '選んだモデルをダウンロードして準備';
    };

    select.onchange = describe;
    describe();

    button.onclick = () => load(
      select.value,
      {
        allowDownload: !saved.find(
          item => item.key === select.value
        )?.complete
      }
    );

    show(
      'off',
      el('b', {}, '生徒側AIを選ぶ'),
      el(
        'p',
        { class: 'small' },
        '保存済みはロードだけです。未保存のモデルや不足ファイルは、準備ボタンを押した時だけ取得します。'
      ),
      select,
      button,
      msg,
      note()
    );
  }

  async function load(key, { allowDownload = false } = {}) {
    if (busy) return false;
    busy = true;

    const model = ai.MODELS.find(item => item.key === key);
    const bar = el('progress', { max: 100, value: 0 });

    const progress = el(
      'span',
      { role: 'status', class: 'small' }
    );

    show(
      'loading',
      el(
        'b',
        {},
        `${model.label}を${
          allowDownload ? '準備' : '保存済みから読み込み'
        }中`
      ),
      bar,
      progress,
      el(
        'p',
        { class: 'small' },
        allowDownload
          ? '保存済みのファイルを再利用し、不足分を取得します。'
          : 'キャッシュ限定で読み込みます。ファイル不足時も勝手にダウンロードしません。'
      )
    );

    try {
      await ai.keepStorage();

      await ai.prepare(
        key,
        value => {
          bar.value = Math.round((value.progress ?? 0) * 100);
          progress.textContent = (value.text ?? '').slice(0, 180);
        },
        { allowDownload, device }
      );

      onChange();

      show(
        'ready',
        el('b', {}, `${model.label}：生徒側AIが使えます`),
        el(
          'p',
          { class: 'small' },
          model.main
            ? '質問の整理と実験助手は、この端末で動きます。クラスへの共有は先生が確認します。'
            : '軽量AIは教材の文章の言い換えを補助します。実験条件の提案やクラス共有は先生側で確認します。'
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'ghost small',
            onclick: async () => {
              await inspect();
              choices();
            }
          },
          '使うモデルを確認・変更'
        ),
        note()
      );

      return true;
    } catch (error) {
      onChange();
      await inspect().catch(() => {});

      choices(
        `準備できませんでした：${error.message}。別のモデルの自動取得はしません。実験・記録は続けられます。`
      );

      return false;
    } finally {
      busy = false;
    }
  }

  const ready = (async () => {
    show(
      'loading',
      el(
        'span',
        { class: 'small' },
        '生徒側AIの保存状況を確認しています。モデルの新規取得は行いません。'
      )
    );

    device = await ai.checkDevice();

    if (!device.webgpu) {
      show(
        'off',
        el(
          'span',
          { class: 'small' },
          'このブラウザでは生徒側AIを動かせません。実験・記録・先生への質問・文字入力は使えます。'
        )
      );

      onChange();
      return;
    }

    try {
      await inspect();

      // 保存済みがある場合だけ自動ロードする。
      for (const model of saved.filter(
        item => item.compatible && item.complete
      )) {
        if (await load(model.key)) return;
      }

      choices(
        saved.some(item => item.reason)
          ? saved.find(item => item.reason).reason
          : saved.some(item => item.weights)
            ? 'モデルの重みは保存されています。不足ファイルがあるため自動ロードは止めています。'
            : 'この配信元には保存済みモデルがありません。以前使ったURLとブラウザも確認してください。'
      );
    } catch (error) {
      show(
        'error',
        el(
          'span',
          { class: 'small' },
          `生徒側AIを確認できませんでした：${error.message}。実験・記録は続けられます。`
        )
      );
    }
  })();

  return {
    ready,
    refresh: async () => {
      await inspect();
      choices();
    }
  };
}

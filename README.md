# クラスで育つ教材

理科の「なぜ？」を、条件を変えて確かめられる問いにする。児童が残した実験記録から先生とGemmaが次の比較を考え、別の児童が同じ条件で続きを調べられるWebアプリです。

- [はじめに読む起動手順](START_HERE_JA.md)
- [工房の11実験と原版3D](docs/EXPERIMENT_STUDIO_JA.md)
- [コードの担当と統合の内訳](CODE_GUIDE_JA.md)
- [提出文面・90秒のデモ台本・著作物](SUBMISSION_JA.md)

Python 3で `python start_local.py` を実行すると、先生と児童のデモを開けます。実験工房は [http://127.0.0.1:8001/hybrid-lab.html](http://127.0.0.1:8001/hybrid-lab.html)。Windowsでは `start_windows.bat` をダブルクリックしても起動できます。

工房と授業の計算モデルは共通です。Gemmaが提案するのは実験と条件です。配信前に先生が確認し、計算と測定はアプリ側が行います。実験の絵や軌跡は3D、測定値は表でも確認できます。児童が記録した結果・根拠・理由は、本人の振り返りと次の問いへつながります。

先生PCのGemma、Bluetooth中継、オフラインでの授業は [起動手順](START_HERE_JA.md) を参照。クラウド側を接続するときの構成は [docs/cloudrun.md](docs/cloudrun.md) です。

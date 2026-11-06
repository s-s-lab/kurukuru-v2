# Kurukuru v2

30分単位の時間グリッドをなぞって回答できる、アカウント登録不要の日程調整ツールです。

## 現在地

- P0：接続・現状確認 完了
- P1：React/Vite/Tailwindの開発基盤 初期構築完了
- P2：API・DB・権限の詳細設計とdevelopment DBマイグレーション完了
- P3：イベント作成・公開取得APIをdevelopment Functionへ実装・実DB検証済み
- P4：イベント作成・参加回答UI、回答登録・編集API 完了
- P5：主催者管理、メール確認、回答通知アウトボックス 実装完了

現行版 `s-s-lab/kurukuru_timegrid-scheduler` とは分離して開発します。

## 開発

```bash
npm install
npm run dev
```

## 検証

```bash
npm run lint
npm test
npm run build
npm run build:function
```

`DATABASE_URL`を設定した環境ではPostgreSQL統合テストも実行されます。development
Functionの実API検証は、`FUNCTION_URL`を設定して`npm run smoke:function`を実行します。

## 公開

**公開一時停止中（2026-11-06）**：トントン開発者への許諾確認が完了するまで、一般向けのKurukuruアプリは公開しません。`.github/workflows/pages.yml`の`main` pushによるPages自動デプロイを停止し、手動実行した場合もアプリ本体ではなく公開停止案内のみを配置します。GitHub Pages側で「Unpublish site」を選択すれば現行配信も停止できます。再公開には公開可否確認に加え、ワークフローの公開停止措置を明示的に解除する必要があります。アプリの開発・テスト、Neon development環境の検証は継続します。公開予定ドメインは`https://kurukuru-app.jp`です。

## ドキュメント

- `docs/p0-status.md`
- `docs/architecture.md`
- `docs/api-contract.md`
- `docs/design/direction.md`

# Kurukuru v2

30分単位の時間グリッドをなぞって回答できる、アカウント登録不要の日程調整ツールです。

## 現在地

- P0：接続・現状確認 完了
- P1：React/Vite/Tailwindの開発基盤 初期構築完了
- P2：API・DB・権限の詳細設計とdevelopment DBマイグレーション完了
- P3：イベント作成・公開取得APIをdevelopment Functionへ実装・実DB検証済み

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

## ドキュメント

- `docs/p0-status.md`
- `docs/architecture.md`
- `docs/api-contract.md`
- `docs/design/direction.md`

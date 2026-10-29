# P0 接続・現状確認

確認日：2026-10-29

## 結果

- GitHubアカウントは `s-s-lab`。既存版 `s-s-lab/kurukuru_timegrid-scheduler` は読み取り対象とし、変更しない。
- `s-s-lab/kurukuru-v2` は未作成。ローカルでは独立Gitリポジトリの `codex/initial-foundation` ブランチで開始した。
- Neon project `gentle-wave-81390226`、main branch `br-snowy-moon-aoktzklw`、database `kurukuru` を確認した。
- mainには暫定5テーブルがあり、データは未投入。既存DDLを削除せず、追加マイグレーションで補完する。
- Neon FunctionsはSingaporeリージョンで利用可能。現時点のデプロイ済みFunctionは0件。
- Neon FunctionsはNode.js 24のHTTPリクエスト処理で、永続ジョブキューではない。回答保存と通知アウトボックス登録を同一DBトランザクションにし、配送は独立した再試行可能処理にする。
- ResendにはKurukuru専用の認証済み送信ドメインがない。既存の失敗状態の無関係ドメインは転用しない。

## 開発環境

- Neonに `development` branch `br-icy-dew-aowwun6d` を作成した。
- main DBを変更せず、マイグレーションとFunctionsはdevelopmentで検証してから反映する。
- 本番メール送信は専用ドメイン認証後に有効化する。

## P0判断

P1・P2へ進行可能。GitHubへの公開リポジトリ作成はGitHubログインが必要なため、ローカルの初期実装後に接続する。


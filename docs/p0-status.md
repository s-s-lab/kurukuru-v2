# P0 接続・現状確認

確認日：2026-10-29

## 結果

- GitHubアカウントは `s-s-lab`。既存版 `s-s-lab/kurukuru_timegrid-scheduler` は読み取り対象とし、変更しない。
- `s-s-lab/kurukuru-v2` を公開リポジトリとして作成済み。初期構築は `codex/initial-foundation` ブランチから開始した。
- Neon project `gentle-wave-81390226`、main branch `br-snowy-moon-aoktzklw`、database `kurukuru` を確認した。
- mainには暫定5テーブルがあり、データは未投入。既存DDLを削除せず、追加マイグレーションで補完する。
- Neon FunctionsはSingaporeリージョンで利用し、developmentブランチへ`kurukuruapi`をデプロイしている。
- Neon FunctionsはNode.js 24のHTTPリクエスト処理で、永続ジョブキューではない。回答保存と通知アウトボックス登録を同一DBトランザクションにし、配送は独立した再試行可能処理にする。
- ResendへKurukuru専用の送信サブドメイン`notify.kurukuru-app.jp`を登録し、XServer DNSへ指定レコードを設定している。

## 開発環境

- Neonに `development` branch `br-icy-dew-aowwun6d` を作成した。
- main DBを変更せず、マイグレーションとFunctionsはdevelopmentで検証してから反映する。
- 本番メール送信は専用ドメイン認証後に有効化する。

## P0判断

P1以降へ進行し、GitHub公開リポジトリ、Neon development環境、Resend送信設定を順次接続した。

## 2026-11-03 ドメイン取得後の更新

- XServerで`kurukuru-app.jp`の取得・決済が完了した。
- DNSはXServerで一元管理し、メール送信サブドメインを`notify.kurukuru-app.jp`とする。
- 送信元は`Kurukuru <no-reply@notify.kurukuru-app.jp>`、Reply-Toなし、受信用メールボックスなしの通知専用構成とする。
- アプリ側のメール確認・回答通知実装、Resendへのドメイン追加、XServer DNSへの指定レコード登録、Neon Function環境変数の投入まで完了。残る外部作業はDKIM最終確認、通知ワーカーの定期呼び出し、本番疎通確認。


# フェーズ進行記録

## 2026-10-29 初期着手

### 実装内容

- React + TypeScript + Vite + Tailwind CSSの骨格
- HashRouterとGitHub Pagesサブパス設定
- トップページの初期UI
- 30分枠・回答マーク・塗り分けのドメイン関数
- Neon developmentブランチ用の追加マイグレーション
- Hono APIのヘルスチェック、許可リストCORS、共通404
- 編集・認証用トークン、管理パスワードのハッシュ処理
- GitHub Actions CI定義

### 外部環境

- Neon development branch：`br-icy-dew-aowwun6d`
- development DB：追加3テーブルと既存テーブル拡張を適用・確認
- development Function：`kurukuruapi` の初回デプロイ完了
- Function health：`{"status":"ok","service":"kurukuru-api"}` を実URLで確認

### テスト

- Vitest：17件
- ESLint
- TypeScript build
- Vite production build
- Neon Function bundle

### 残課題

- GitHub Pagesの有効化と公開URLでの動作確認
- 公開URLでのPC・スマホ視覚検証
- イベント作成APIとDBトランザクション
- 回答・編集・管理API
- 時間グリッド本体とイベント作成画面
- Kurukuru専用送信ドメインの認証とResend接続

### 次フェーズ

GitHubリポジトリを作成後、P3のイベント作成・回答APIをテスト先行で実装する。

## 2026-10-30 P3 イベント作成・公開取得API

### 実装内容

- `POST /api/v1/events`：入力検証、管理パスワードのハッシュ化、候補枠登録
- `GET /api/v1/events/:eventId`：イベント・候補枠・回答状況の公開取得
- イベント、候補枠、メール認証トークンハッシュ、冪等応答の同一DBトランザクション保存
- `Idempotency-Key`による二重登録防止と異内容再利用の409応答
- 期限切れ冪等キーの再利用と、期限前の競合防止
- PostgreSQL共有カウンタによる全体上限（1分60回）と主催者メール単位上限（10分10回）
- イベント作成本文の64KiB上限
- 主催者メール、管理パスワード、各種ハッシュを公開レスポンスから除外
- JSON不正、入力不正、存在しないイベント、内部エラーの共通JSON応答
- `DATABASE_URL`からPoolを生成するFunctionランタイム構成
- development Function用の実APIスモークテスト

### 外部環境

- Neon development branchのみを使用。main branchは未変更
- development Function `kurukuruapi` deployment 7へ反映
- `pg`はESMバンドルへ内包せず、Node依存としてFunctionへ同梱
- 実APIで作成201、同一キー再送201、異内容再利用409、公開取得200を確認
- CIでPostgreSQL 18を起動し、全マイグレーションとDB統合テストを実行する構成へ更新

### 次フェーズ

- 回答登録・編集APIと編集専用トークン
- 管理者認証・管理セッション
- 候補日時編集、開催日時確定、受付停止・再開
- 回答保存と通知アウトボックスの同一トランザクション化
- Resend送信ドメイン認証後のメール配送

## 2026-10-30 P3 回答登録・編集API

### 実装内容

- 全候補枠の回答POSTと、編集専用Bearerトークンによる回答PATCH
- 冪等キー再送で同じ回答ID・同じトークンを返し、公開GETに現在の回答を反映
- HMACによるトークン導出とハッシュだけの永続化。32文字以上の`KURUKURU_TOKEN_SECRET`を起動時に必須化
- 内容変更時だけ回答versionを加算し、認証済み・通知ONの主催者への通知を同一トランザクションで予約
- 全枠一致、本文128KiB制限、二段階レート制限、存在を隠す編集認証404
- development向けスモークを回答作成・再送・公開取得・1枠ngへの更新・再取得・秘密情報非公開へ拡張

### ローカル検証

- `npm run lint && npm test -- --run && npm run build && npm run build:function && npm run test:function-bundle`：exit 0
- Vitest：100件成功、45件skip（回答PostgreSQL統合42件と既存DB統合3件。通常実行時はDATABASE_URL未設定）
- ESLintエラー・警告0、TypeScript/ViteビルドとFunctionビルド成功、バンドルヘルス成功
- 既存のnpm `Unknown env config "http-proxy"`警告は継続

### development環境の実検証

- Neon project `gentle-wave-81390226` / development `br-icy-dew-aowwun6d`だけを変更
- `db/migrations/0003_response_version.sql`そのままを適用。`responses.version`のinteger・NOT NULL・DEFAULT 1・CHECK(version >= 1)をカタログで確認
- `kurukuruapi` deployment **8**：completedかつactiveを確認。`pg`と推移依存をNodeパッケージとして同梱
- 強いランダムな64文字の`KURUKURU_TOKEN_SECRET`をdevelopment Functionへ設定。DB接続はNeonの注入を使用し、秘密値はログ・リポジトリへ保存しない
- 実URLのヘルス200：`{"status":"ok","service":"kurukuru-api"}`
- スモーク成功：イベント201、同一再送201、異内容409、回答201、回答再送201（同じID・トークン）、公開GET 200、PATCH 200、再取得200。5枠bestから1枠ngへの反映と公開応答の秘密情報非公開を確認
- 成功時event ID：`9c93602f-e030-4886-abf9-9bf06fa6298d`、response ID：`cb006e4f-7044-48f5-9860-c2a7631118af`。DBでもversion 2・回答枠5件・ng 1件を確認。主催者未認証のため通知アウトボックス0件で、メール配送は未検証
- 全枠のID・mark完全一致assertを含む最終スモークもexit 0。event `71c1709d-0579-4294-814a-40ffa20d3191`、response `7d8330bf-a307-4606-bef7-a42516f1c6b1`で同じ成功ステータスを確認
- 旧deployment 7で拡張スモークが回答POSTの404を検出することも先に確認
- main `br-snowy-moon-aoktzklw`は変更なし。前後の読み取りでversion列なしを確認し、対象Functionへのprobeは前後とも`404/not visible`だった。すべての変更系ツールへdevelopment branch IDとproject IDを明示

### 検証の限界

- 移行後にdevelopment接続で回答PostgreSQL統合42件の実行を試したが、全42件が最初のfixture INSERT前に`getaddrinfo EAI_AGAIN`で失敗。この実行環境からDBホストへ接続できず、SQL・ロック・同時実行・ロールバックの統合検証は未完了
- 試行前後の`response integration`イベント数は0。統合テストによる永続fixture残骸なし
- 実APIスモークは逐次フローの検証であり、同時実行や通知配送のカバレッジではない。DBへ接続できるCIで統合テストのGREENを確認する必要がある
- スモークはdevelopmentに識別可能な検証イベントを残す。GitHub push・merge・main DB・本番公開設定の変更は実施していない

### スモーク診断の秘密情報保護（修正確認）

- 不正JSONの応答本文をエラーへ含めず、HTTPステータスと汎用メッセージだけを出す共有readerへ変更
- 合成トークンを含む途切れたJSONを回答作成・再送・公開GET・PATCH・更新後GETに注入し、実際の子プロセスのstdout/stderrへ本文が出ないことを検証。修正前5件失敗・成功対照1件、修正後6件成功
- 全ローカル検証を再実行してexit 0：106件成功・45件DB skip、Lint・両ビルド・バンドルヘルス・3スクリプトの構文検証成功
- developmentスモーク再実行もexit 0：event `675aa9d0-90e2-4d64-a2e7-16bc1faa9fe2`、response `57c886bf-aad1-47e1-a4ca-bf73ef57adf3`。既記録と同じ成功ステータス・公開秘密情報チェックを確認
- この修正確認ではNeonのスキーマ・Function・環境変数・mainを変更していない。既存の42件DB統合検証の不足は継続

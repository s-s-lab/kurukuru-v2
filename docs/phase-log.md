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

## 2026-10-31 P4 イベント作成UI

### 実装内容

- 基本情報・候補日時・確認の3段階を接続。確認画面はタイトル、説明、主催者メール、通知設定、候補日と連続した時間範囲を表示し、管理用パスワードは表示しない
- 既存APIクライアントと正規化ヘルパーによるイベント作成。送信中は作成・戻るを無効化し、二重送信を防止
- 安全なAPIエラーとリクエストIDを表示。未知の内部エラーやパスワードを含むエラー詳細は反映しない
- 再試行・変更なしの戻る操作は同じ冪等キーを再利用し、基本情報または候補日時の変更後は新しいキーを使用
- 成功画面に参加者用URL・主催者用URL、各コピー操作、読み上げ可能なコピー成功・失敗フィードバック、主催者用URLの保存案内、トップへの完了リンクを追加
- 作成成功後は入力下書きをメモリから除去。依存追加・バックエンド・API契約の変更なし

### 検証

- TDD：確認・送信・共有のテストを先に追加しREDを確認後、実装してGREEN。確認から戻ったときの選択時間保持も直接検証
- フロー16件成功。全体156件成功・47件skip（DATABASE_URL未設定のPostgreSQL統合4ファイル）
- ESLint、TypeScript/Viteビルド、Functionビルド、Functionバンドルヘルスはいずれもexit 0
- コンセプト画像を目視し、デスクトップ1440×1000・モバイル390×844を対象にCSS/DOMを2回レビュー。既存の白・紺・Teal、レスポンシブ単一DOM、モバイル固定アクション、URL欄の縮小・折り返し対策を確認
- Chromium/Chrome/Firefox/headless_shellの実行ファイル、Playwright/Selenium/WeasyPrintはローカルに見つからず、実画面レンダリング・スクリーンショット比較・実際の横幅計測は未実施。ブラウザーでの最終視覚確認が必要

### 残課題

- 共有URLの遷移先である参加者の回答画面・主催者の管理画面は後続フェーズで実装する（作成・共有UIは完了）
- メール認証と通知配送のエンドツーエンド検証、およびDB接続可能な環境での統合テスト
- ローカルのnpm `Unknown env config "http-proxy"`警告は継続

## 2026-11-02 P4 参加者回答UI

### 実装内容

- 参加者用URL `#/events/:eventId` を実画面へ接続し、公開イベントの読込、読込失敗、回答受付終了を表示
- 候補日の疎な時間グリッドを日付行・30分列で構成。非候補枠は操作不可、全候補枠は初期値`ng`としてAPIの全枠必須契約と一致
- ◎希望・○参加可・△未定・×不可の記号・文字・色を併用し、PCのクリック／ドラッグ、スマートフォンの塗る／移動切替、キーボード操作に対応
- 既存回答から時間帯別人数を集計し、公開回答の概要を時間グリッド下へ表示
- 回答POSTは同一内容の再試行で同じ冪等キーを維持。成功後は回答IDと編集トークンだけをイベント単位でlocalStorageへ保存
- 端末内の編集情報と公開回答IDが一致する場合だけ回答を復元し、PATCH時だけ編集トークンをBearerへ設定。トークンはDOM・ログ・公開応答へ表示しない
- API成功応答をZodで検証し、非JSON・構造不正の成功／失敗応答から上流本文や秘密情報を露出しない
- 承認済みの白・紺・Teal・Pale aquaを維持し、PCの2カラム概要・時間表、モバイルの縦積み・横スクロール・固定保存操作をCSSへ追加

### 検証

- 回答モデル12件、APIクライアント15件、時間グリッドと既存作成フロー21件、ページ統合5件をテスト先行で実装
- 全体Vitest：179件成功、47件skip（`DATABASE_URL`未設定のPostgreSQL統合4ファイル）
- TypeScript/Viteビルド、Functionビルド、Functionバンドルヘルス成功
- 承認済みデスクトップ／モバイル画像を原寸で再確認し、コピー、白背景、配色、4状態、操作モード、日付固定列、横スクロール、回答人数、保存操作をCSS/DOMと照合
- クラウドブラウザからローカル検証サーバーへの接続は`ERR_CONNECTION_REFUSED`。ブラウザ実行環境と開発環境が別ネットワークのため、実画面キャプチャ比較は未実施

### 残課題

- GitHub CIでPostgreSQL統合テストを含む全件実行と、ブラウザ到達可能なPreview環境でのPC 1440×1000・モバイル390×844の最終視覚確認
- 主催者管理画面、管理者認証、候補日時編集、日時確定、受付停止・再開
- メール認証と通知配送のエンドツーエンド検証

## 2026-11-02 P5 管理認証・基本管理API

### 実装内容

- `POST /api/v1/events/:eventId/admin/sessions`：管理パスワードを検証し、12時間有効の管理セッションを発行
- `GET /api/v1/events/:eventId/admin`：主催者メール、認証状態、通知設定、versionを含む管理状態を取得
- `PATCH /api/v1/events/:eventId`：タイトル、説明、回答通知設定を変更
- `POST /api/v1/events/:eventId/close`・`reopen`：回答受付を停止・再開
- セッショントークンは強いランダム値を一度だけ返し、DBにはSHA-256ハッシュだけを保存
- 期限切れ、不正、別イベント用セッションと、削除済み・不明イベントを同じ`404 ADMIN_ACCESS_DENIED`へ統一
- 管理変更はイベント行をロックし、実変更時だけversionとupdated_atを更新。重複close／reopenは冪等
- ログインは全体60回/分・イベント10回/10分、管理操作は全体300回/分・イベント120回/10分で制限
- 管理JSON本文を16KiBに制限し、未知の例外はレスポンスとログの双方でメッセージ本文を非公開化
- セッショントークン・非公開管理情報を含む全管理レスポンスへ`Cache-Control: no-store`を設定

### 検証

- 管理サービス7件（既存秘密処理を含む）、PostgreSQL管理リポジトリ単体5件、管理HTTP・runtimeを含む集中テスト85件が成功
- PostgreSQL管理リポジトリ統合1件は`DATABASE_URL`未設定のローカル環境ではスキップし、CIで実行する
- 全体Vitest：204件成功、48件skip（`DATABASE_URL`未設定のPostgreSQL統合5ファイル）
- ESLint、TypeScript/Viteビルド、Functionビルド、Functionバンドルヘルスが成功

### 残課題

- 候補日時編集、開催日時確定・解除、イベント論理削除の管理API
- 主催者用管理画面と、ブラウザ内での管理セッション保持・期限切れ再ログイン
- 主催者メール変更・メール認証・通知配送
- PostgreSQL 18を使うGitHub CIで管理統合テストを含む全件実行

## 2026-11-02 P5 管理ライフサイクルAPI

### 実装内容

- `PUT /api/v1/events/:eventId/candidate-slots`：候補枠の全件置換。日付・枠順へ正規化し、保持枠のIDと回答を維持しながら差分だけを更新
- 追加候補枠は既存の全回答へ`ng`を補完し、削除候補枠の回答可否は外部キーcascadeで削除。実差分がない再実行はversionとupdated_atを維持
- 確定済み範囲の候補を外す更新は、書込み前に`409 EVENT_FINALIZED`としてトランザクションを中止
- `POST /api/v1/events/:eventId/finalization`：同一日の連続した候補枠だけを、終了境界exclusiveで確定。不連続・候補外は`422 INVALID_FINALIZATION`
- `DELETE /api/v1/events/:eventId/finalization`：確定を解除。同一確定の再設定と未確定状態への再解除は冪等
- 確定と回答受付停止を独立操作のままとし、確定時にopen/closedを暗黙変更しない
- `DELETE /api/v1/events/:eventId`：イベントを論理削除し、そのイベントの全管理セッションを同一トランザクションで失効。成功は本文なし204
- 全操作へ既存の管理Bearer認証、二段階レート制限、16KiB本文上限、`Cache-Control: no-store`、秘密情報を隠す固定エラーを適用
- 既存DBスキーマと外部キーを使用し、マイグレーション追加なし

### 検証

- TDDでバリデーション19件、管理サービス4件、PostgreSQL管理リポジトリ単体13件、管理HTTPを含むテストを追加・更新し、各REDからGREENを確認
- 全体Vitest：236件成功、50件skip（`DATABASE_URL`未設定のPostgreSQL統合5ファイル）。管理リポジトリ統合3件には候補差分・ng補完・確定枠保護・確定/解除の冪等性・論理削除・全セッション失効を含む
- ESLintエラー・警告0、TypeScript/Viteビルド、Functionビルド、Functionバンドルヘルスが成功
- `git diff --check`で空白エラーなし。既知のnpm `Unknown env config "http-proxy"`警告は継続

### 残課題

- 主催者用管理画面と、ブラウザ内での管理セッション保持・期限切れ再ログイン
- 主催者メール変更・メール認証・通知配送
- PostgreSQL 18を使うGitHub CIで、新規管理統合3件を含む全件実行

## 2026-11-02 P5 主催者管理画面（基本管理）

### 実装内容

- 主催者用URL `#/events/:eventId/admin` を追加し、イベント情報を事前開示しない管理パスワードログインを実装
- 管理セッションはイベント単位の`sessionStorage`へ`sessionToken`と`expiresAt`だけを保存し、同一タブの再読込時に復元。パスワードはフォームのReact stateだけに保持して送信後に破棄
- 期限切れ・不正・失効したセッションと`ADMIN_ACCESS_DENIED`を検出すると保存値を削除し、安全な再ログイン表示へ戻す
- 管理APIクライアントでログイン、管理状態取得、基本情報更新、回答受付停止・再開の成功応答をZod検証。非JSON・構造不正・通信失敗の本文や秘密値を例外へ含めない
- 回答状況を候補日×30分枠の読み取り専用時間表として表示し、各枠の◎希望・○参加可・△未定・×不可の人数、回答者名、コメント、更新日時を表示
- 候補日の範囲と開催日時の確定状態を表示。確定終了時刻はAPIのexclusive境界を正しく表示し、23:30〜24:00にも対応
- タイトル、説明、回答通知設定の編集とフィールドエラー表示、回答受付の停止・再開、参加者用URLの共有／コピーを実装
- PCは回答状況2/3・設定1/3、900px以下は縦積み、モバイルは時間表だけを横スクロール。白・Deep navy・Teal・Pale aquaの既存デザインと44px操作領域、フォーカスリング、live regionを維持

### 検証

- 管理API、セッションモデル、集計モデル、ログイン、設定、受付状態、回答概要、ページ統合、ルーティングをテスト先行で実装し、対象50件が成功
- 全体Vitest：284件成功、50件skip（`DATABASE_URL`未設定のPostgreSQL統合5ファイル）
- 独立コードレビュー後、別イベント遷移時の状態分離、参加者URLへのquery非継承、設定更新と受付操作の直列化、未保存下書き保持、管理成功応答の日付・時刻・枠境界検証、疎な時間表セルのアクセシビリティを追加検証・修正
- TypeScript型検査とESLintが成功
- 実行環境にChromium、Chrome、Firefoxの実行ファイルがなく、レンダリング済み画面のスクリーンショット比較は未実施。DOM/CSSを承認済み仕様のデスクトップ、900px、640px、320px要件と照合

### 残課題

- 管理画面からの候補日時編集、開催日時の確定・解除、イベント論理削除（管理APIは実装済み）
- ブラウザ到達可能なPreview環境でのPC 1440×1000・モバイル390×844の最終視覚確認
- 主催者メール変更・メール認証・通知配送と、PostgreSQL 18を使うGitHub CIでの全統合テスト

## 2026-11-03 P5 主催者管理画面（ライフサイクル管理）

### 実装内容

- 認証済み管理画面へ候補日時編集を追加。06:00〜24:00の30分単位グリッドで候補日・候補枠を追加、削除し、全件置換APIへ正規化して保存
- 候補日時変更が既存回答へ反映されることを明示し、確定範囲を削除しようとした`EVENT_FINALIZED`では、先に確定解除が必要であることを具体的に案内
- 候補日、開始時刻、終了時刻の選択式で開催日時を確定。連続し、すべて候補枠に含まれる範囲だけを送信し、確定解除も同じ画面から実行
- 回答受付の停止・再開と開催日時の確定・解除を独立操作として維持
- イベント削除を他の設定から分離した危険操作として追加。イベント名の完全一致を必須とし、成功後は同一タブの管理セッションを削除して完了画面へ遷移
- 基本情報、受付状態、候補日時、確定日時、削除の変更操作を直列化し、別操作中も基本情報と候補日時の未保存下書きを維持
- 管理APIクライアントへ候補枠置換、確定、確定解除、204本文なし削除を追加し、既存のBearer認証、安全なAPIエラー、Zod成功応答検証を継続
- PCは確定操作と候補日時表を並列配置し、900px以下で縦積み、640px以下で入力と操作を全幅化。時間表だけを横スクロールさせ、320px幅でページ全体の横スクロールを避ける

### 検証

- APIクライアント、日程モデル、ページ統合をテスト先行で追加し、候補日時の正規化保存、連続範囲検証、確定・解除、イベント名確認、削除後セッション消去を検証
- 実Functionルートと照合し、候補枠置換`PUT`、確定`POST`、確定解除`DELETE`、イベント削除`DELETE`の契約一致を確認
- 独立レビュー後、操作中表示を実際の操作種別へ分離し、イベント削除成功を204応答だけに限定。想定外の2xx応答から秘密本文を露出しないこと、確定入力エラーと各選択欄の関連付け、44px削除操作領域を追加検証・修正
- 全体Vitest：295件成功、50件skip（`DATABASE_URL`未設定のPostgreSQL統合5ファイル）
- TypeScript/Viteビルド、Functionビルド、Functionバンドルヘルスが成功
- 実行環境にブラウザ実行ファイルがないため、レンダリング済み画面の視覚確認は引き続きPreview環境で実施する

### 残課題

- ブラウザ到達可能なPreview環境でのPC 1440×1000・モバイル390×844の最終視覚確認
- 主催者メール変更・メール認証・回答通知配送
- PostgreSQL 18を使うGitHub CIでの全統合テスト

## 2026-11-03 P5 主催者メール確認・回答通知

### 実装内容

- `kurukuru-app.jp`を公開ドメイン、`notify.kurukuru-app.jp`をResend送信サブドメインとし、`Kurukuru <no-reply@notify.kurukuru-app.jp>`からReply-Toなしで送る構成を確定
- 管理Bearer認証付きの確認メール送信・再送APIと、24時間有効な公開確認APIを追加。生トークンを保存せずSHA-256ハッシュだけをDBへ保持し、再送時にローテーション
- 確認済み日時をメール確認行とイベント行へ同一トランザクションで反映。同じ有効リンクの再実行を冪等化し、無効・期限切れ・削除済みを固定404へ統一
- fetchベースのResendアダプターを追加し、Authorization、Idempotency-Key、HTML/text本文を送信。事業者の失敗本文や例外本文をAPI・DBへ保存しない
- 回答通知アウトボックスを最大10件ずつclaimする内部APIを追加。ワーカー秘密値を定時間比較し、不一致時はAPIの存在を隠す404を返す
- `FOR UPDATE SKIP LOCKED`で並行ワーカーを分離し、15分停滞した`sending`行を回収。1・2・4分の指数バックオフを最大6時間で上限化し、provider message IDを保存
- 管理画面にメール確認状態、確認メール送信、通知オフ時の説明を追加。公開確認画面は確認中・完了・無効／期限切れ・一時エラーを表示し、生トークンを画面へ出さない
- メール設定が未投入でも既存APIは起動し、メール関連ルートだけを503にする任意構成とした

### 検証

- メールテンプレート、Resendアダプター、確認サービス、PostgreSQL確認リポジトリ、HTTP/runtime、通知ディスパッチャー、PostgreSQL通知リポジトリ、管理UI、公開確認画面、ルーティングをテスト先行で実装
- 全体Vitest：342件成功、52件skip（`DATABASE_URL`未設定のPostgreSQL統合7ファイル）
- ESLintエラー・警告0、TypeScript型検査、Vite本番ビルド、Functionビルド、Functionバンドルヘルスが成功

### 外部設定の残課題

- Resendへ`notify.kurukuru-app.jp`を追加し、表示されたSPF/DKIM等のDNSレコードをXServer DNSへ登録してVerifiedにする
- Neon Functionへ`RESEND_API_KEY`、`KURUKURU_MAIL_FROM`、`KURUKURU_PUBLIC_BASE_URL`、`KURUKURU_NOTIFICATION_WORKER_SECRET`を設定する
- Neonのスケジュール機能または外部スケジューラから通知drain APIを定期呼び出しする
- development環境で実メール確認と回答通知を疎通後、本番へ反映する
- ブラウザ到達可能なPreview環境でPC・モバイルの最終視覚確認を行う

## 2026-11-04 P5 主催者メール変更・再認証

### 実装内容

- 管理画面の基本情報へ主催者メールアドレス欄を追加し、trim・小文字化・メール形式検証後に既存の管理更新APIへ送信
- 主催者メールが変わった場合、イベント行ロック下で確認済み状態を解除し、旧確認リンクと未送信・再試行待ちの回答通知を同一トランザクションで削除
- 正規化後に同一のメールアドレスなら確認済み状態と旧確認リンクを維持し、不要な再確認を発生させない
- 回答通知をONからOFFへ変更した場合も、未送信・再試行待ちの通知を削除
- イベントと通知アウトボックスへ通知世代を追加。メール変更・通知OFF時に世代を進め、ワーカー取得済みの旧通知が失敗後に新しいアドレス向けとして再試行される競合を防止
- マイグレーション時点で通知OFF・メール未確認・削除済みの既存イベントも世代を進め、旧pending/failed通知を削除。通知claim用の部分複合インデックスを追加
- 通知ワーカーはイベントを先にロックし、主催者メール確認済み・通知ON・イベント有効・通知世代一致を再検査してからアウトボックスを取得
- メール確認もイベント→確認トークンの順でロックし、管理更新との逆順ロックを解消
- メール変更保存後は管理画面を未確認表示へ更新し、新しいアドレスへの確認メール送信を具体的に案内。変更前アドレス向けの送信済み案内は消去
- `.env.example`を現在のFunction環境変数名へ更新

### 検証

- 全体Vitest：355件成功、55件skip（`DATABASE_URL`未設定のPostgreSQL統合8ファイル）
- ESLintエラー・警告0、TypeScript型検査、Vite本番ビルド、Functionビルド、Functionバンドルヘルスが成功

## 2026-11-04 P5 development環境反映

### 反映内容

- developmentブランチ`br-icy-dew-aowwun6d`の`kurukuru`データベースへ`0004_notification_generation.sql`を適用
- `events`と`notification_outbox`の通知世代列、および通知claim用インデックス2件を確認。既存アウトボックスは0件で、不正な通知世代は0件
- Neon Functionをdeployment 9へ更新し、主催者メール変更・再認証対応を含むAPIバンドルをdevelopment環境へ反映
- mainブランチ`br-snowy-moon-aoktzklw`はマイグレーション未適用のまま維持

### 検証

- development Functionの`/api/v1/health`が`status: ok`を返すことを確認
- development Function向けスモークテストがexit 0で完了し、DB上の既存イベント11件・回答5件・最大回答version 2を確認
- 一時検証ブランチへ同じマイグレーションを適用し、列2件・インデックス2件・不正世代0件を確認
- 一時検証ブランチを使うPostgreSQL統合テストは、実行環境からNeonホストを名前解決できず`EAI_AGAIN`で接続前に失敗。非DBテスト355件は成功し、SQL実行によるスキーマ検証で補完

### 外部設定の残課題

- XServer DNSへResend指定のDKIM・SPFレコード4件を登録。ResendでSPFのMX/TXTとCNAMEはVerified、DKIMはDNS伝播待ち
- Resendで`notify.kurukuru-app.jp`限定の送信専用APIキーを作成し、Neon Function deployment 10へメール送信・公開URL・通知ワーカー用の環境変数を追加。既存の`KURUKURU_TOKEN_SECRET`が維持されたことを確認
- deployment 10のHealthと、イベント作成・冪等再実行・競合・回答作成・管理認証・更新を含むスモークテストがexit 0で完了
- DKIM認証後に実メールのエンドツーエンド検証を行う
- 検証用一時ブランチ`test-0004-notification-generation-20261104`を承認後に削除し、mainとdevelopmentの2ブランチだけが残っていることを確認

## 2026-11-04 P6 GitHub Pages公開準備

### 実装内容

- `kurukuru-app.jp`をルートとして配信するため、Viteの`base`を`/`へ変更
- `main`へのpushと手動実行に対応するGitHub Pagesワークフローを追加
- Node.js 24で依存関係を固定インストールし、Viteの`dist`だけをPages artifactとして配置
- Webビルドへdevelopment Neon Functionの公開`/api/v1` URLを設定。秘密情報はビルド環境へ渡さない
- Pagesのデプロイ権限を`pages: write`と`id-token: write`へ限定し、同時デプロイを直列化

### 検証

- 公開設定テストで、独自ドメイン用のルートパス、Pages公式Actions、artifact対象、API URLを検証
- development API URLを指定したVite本番ビルドが成功し、生成HTMLのCSS・JavaScript参照が`/assets/`であることを確認

### 外部設定の残課題

- GitHub PagesをGitHub Actions公開に設定し、`kurukuru-app.jp`をカスタムドメインとして登録
- XServer DNSへGitHub Pages用のapex A/AAAAレコードと`www` CNAMEを設定
- Neon FunctionのCORS許可元へ`https://kurukuru-app.jp`を追加
- HTTPS発行後、PC・モバイル表示、イベント作成、メール確認、回答通知を実環境で確認

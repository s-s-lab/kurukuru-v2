# Kurukuru メール認証・回答通知 設計

## 目的

主催者が所有するメールアドレスを確認した後だけ、参加者の回答登録・更新を主催者へ通知する。送信元はKurukuru専用ドメインとし、返信を受け付けない通知専用メールとして運用する。

## 確定した送信構成

- 取得ドメイン：`kurukuru-app.jp`
- DNS管理：XServerドメイン
- 送信サブドメイン：`notify.kurukuru-app.jp`
- From：`Kurukuru <no-reply@notify.kurukuru-app.jp>`
- Reply-To：設定しない
- 受信用メールボックス：作成しない
- 配信事業者：Resend
- Web：GitHub Pages、API/DB：Neon Functions / Neon PostgreSQLを継続する

ResendのAPIキーはFunction環境変数だけに保存する。GitHub Pagesのビルド成果物、ブラウザ、DB、ログへ含めない。

## 主催者メール認証

### 認証メール送信・再送

管理セッションで認証した主催者だけが`POST /api/v1/events/:eventId/email-verifications`を実行できる。実行時に新しい高強度トークンを生成し、DBにはSHA-256ハッシュだけを保存する。トークンの有効期限は送信準備時点から24時間とする。

未認証ならResendで認証メールを送信し、`sent`を返す。すでに認証済みならメールを送らず`already-verified`を返す。送信準備後にResendが失敗した場合は安全な`EMAIL_DELIVERY_FAILED`を返し、次の再送でトークンを再生成する。

送信回数は全体60回/分、イベント5回/10分で制限する。管理操作の既存制限も先に適用する。

### 認証完了

メール内リンクは`KURUKURU_PUBLIC_BASE_URL/#/email-verifications/:token`とする。ブラウザ画面が`GET /api/v1/email-verifications/:token`を呼び出す。

APIはトークンハッシュ、有効期限、未削除イベントを同一トランザクションで確認し、`email_verifications.verified_at`と`events.organizer_email_verified_at`を更新する。同じ有効トークンの再実行は成功扱いとする。不正・期限切れ・削除済みは区別せず`404 EMAIL_VERIFICATION_NOT_FOUND`を返す。応答は`Cache-Control: no-store`とする。

## 回答通知配送

既存どおり、回答保存と`notification_outbox`登録を同一DBトランザクションにする。主催者メール認証済みかつ`notify_on_response = true`の場合だけ登録する。

内部配送API`POST /api/v1/internal/notifications/drain`は`KURUKURU_NOTIFICATION_WORKER_SECRET`をBearerで要求する。最大10件を`FOR UPDATE SKIP LOCKED`で確保し、`sending`へ遷移してからResendへ送る。

- 成功：`sent`、`sent_at`、Resendのmessage IDを保存
- 失敗：`failed`、安全に切り詰めたエラー分類、次回試行時刻を保存
- 再試行：1分、2分、4分、8分、以後最大6時間の指数バックオフ
- 回収：`sending`のまま15分を超えたレコードも再取得可能にする
- 重複防止：既存`notification_outbox.idempotency_key`をResendのIdempotency-Keyへ渡す

回答通知本文には、イベント名、回答者名、登録または更新の別、主催者管理画面へのリンクだけを記載する。回答コメントや全候補日時はメール本文へ載せない。

## メール本文

### 認証メール

- 件名：`【Kurukuru】主催者メールアドレスを確認してください`
- イベント名
- 24時間有効の認証リンク
- 心当たりがなければ破棄する案内
- 「送信専用のため返信できない」旨

### 回答通知

- 件名：`【Kurukuru】「イベント名」に回答が届きました`または`回答が更新されました`
- 回答者名
- 主催者管理画面リンク
- 「送信専用のため返信できない」旨

HTMLへ埋め込む値は必ずエスケープし、同内容のプレーンテキストも送信する。

## 管理画面

主催者メール、認証済み/未認証、認証メール送信・再送ボタンを基本設定に表示する。認証完了後は送信ボタンを非表示にする。未認証でも通知設定は保存できるが、「認証完了までは回答通知が送信されない」と明示する。

認証リンク画面は、確認中、成功、不正または期限切れ、通信失敗を区別して表示する。トークンを画面本文、ログ、エラー詳細へ表示しない。

## Function環境変数

- `DATABASE_URL`
- `KURUKURU_TOKEN_SECRET`
- `KURUKURU_ALLOWED_ORIGINS`
- `RESEND_API_KEY`
- `KURUKURU_MAIL_FROM=Kurukuru <no-reply@notify.kurukuru-app.jp>`
- `KURUKURU_PUBLIC_BASE_URL`
- `KURUKURU_NOTIFICATION_WORKER_SECRET`

Resend関連設定がない環境でも既存APIは起動可能とし、メールAPIだけ`503 SERVICE_UNAVAILABLE`を返す。これによりローカル開発と既存デプロイを壊さない。

## 今回の完了条件

- 認証メール送信・再送APIと認証完了APIがテスト済み
- Resendクライアント、HTML/テキストテンプレート、Idempotency-Keyがテスト済み
- 通知アウトボックス配送と再試行がテスト済み
- 管理画面の認証状態・送信操作と公開認証画面がテスト済み
- 既存テスト、Lint、型検査、Web/Functionビルドが成功
- 実メール配送はResendで`notify.kurukuru-app.jp`を認証し、Neonへ秘密値を設定した後にdevelopment環境で検証する

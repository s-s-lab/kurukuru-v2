# アーキテクチャ

## 構成

- Web：React 19、TypeScript、Vite、Tailwind CSS、HashRouter
- API：Neon Functions上のHonoアプリ
- DB：Neon PostgreSQL
- 通知：DBアウトボックス + Resend
- 公開：GitHub Pages
- 公開ドメイン：`kurukuru-app.jp`（XServerで取得・DNS管理）

ブラウザからDBへ直接接続しない。すべての読み書きはNeon FunctionsのAPIを通す。公開取得、回答編集、主催者操作を別の認可境界として扱う。

## 秘密情報

- 管理パスワードは平文保存せず、サーバー側でハッシュ化する。
- 回答編集トークン・管理セッション・メール認証トークンは高強度乱数を使用し、DBにはハッシュだけを保存する。
- `DATABASE_URL`はNeon Functionsが注入する。Resendキーと管理セッション秘密はFunction環境変数として保持する。
- メール送信は`notify.kurukuru-app.jp`をResendで認証し、`Kurukuru <no-reply@notify.kurukuru-app.jp>`を送信専用アドレスとして使用する。受信用メールボックスとReply-Toは作らない。
- GitHub Pagesのビルド成果物に秘密情報を含めない。

## Web公開

`main`への更新を`.github/workflows/pages.yml`が検知し、Node.js 24でViteをビルドしてGitHub Pagesへ配置する。独自ドメインをルートとして配信するため、Viteの`base`は`/`とする。ブラウザへ埋め込むのは公開済みNeon Functionの`/api/v1` URLだけで、APIキーやワーカー秘密値は埋め込まない。

## 通知整合性

回答の新規・更新と通知アウトボックスの作成を同一トランザクションにする。メール認証済みかつ通知ONの場合だけアウトボックスを作成する。配送失敗は回答保存を取り消さず、再試行時刻と試行回数を更新する。

通知ワーカーは秘密値で保護されたFunctionルートから最大10件をclaimする。`FOR UPDATE SKIP LOCKED`で並行実行を分離し、処理中のまま15分経過した行を回収する。Resendの冪等キー、指数バックオフ、provider message IDをアウトボックスへ保持し、回答の保存可否をメール事業者の状態から切り離す。

## メール確認境界

確認トークンは24時間有効で、送信のたびにローテーションする。生トークンはメールリンクと処理中メモリにだけ存在し、DBにはSHA-256ハッシュだけを保存する。確認済み日時は`email_verifications`と`events`を同一トランザクションで更新し、同じ有効リンクの再実行は冪等に成功する。


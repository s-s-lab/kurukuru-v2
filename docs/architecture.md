# アーキテクチャ

## 構成

- Web：React 19、TypeScript、Vite、Tailwind CSS、HashRouter
- API：Neon Functions上のHonoアプリ
- DB：Neon PostgreSQL
- 通知：DBアウトボックス + Resend
- 公開：GitHub Pages

ブラウザからDBへ直接接続しない。すべての読み書きはNeon FunctionsのAPIを通す。公開取得、回答編集、主催者操作を別の認可境界として扱う。

## 秘密情報

- 管理パスワードは平文保存せず、サーバー側でハッシュ化する。
- 回答編集トークン・管理セッション・メール認証トークンは高強度乱数を使用し、DBにはハッシュだけを保存する。
- `DATABASE_URL`はNeon Functionsが注入する。Resendキーと管理セッション秘密はFunction環境変数として保持する。
- GitHub Pagesのビルド成果物に秘密情報を含めない。

## 通知整合性

回答の新規・更新と通知アウトボックスの作成を同一トランザクションにする。メール認証済みかつ通知ONの場合だけアウトボックスを作成する。配送失敗は回答保存を取り消さず、再試行時刻と試行回数を更新する。


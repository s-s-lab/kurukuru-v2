# API契約 v0.1

ベースパス：`/api/v1`

| Method | Path | 認可 | 用途 |
|---|---|---|---|
| POST | `/events` | 公開・レート制限・冪等キー | イベントと候補枠を作成 |
| GET | `/events/:eventId` | 公開 | 公開可能なイベント・回答集計を取得 |
| POST | `/events/:eventId/responses` | 公開・レート制限・冪等キー | 回答登録と編集リンク発行 |
| PATCH | `/responses/:responseId` | 回答編集トークン | 回答編集 |
| POST | `/events/:eventId/admin/sessions` | 管理パスワード・レート制限 | 短命管理セッション発行 |
| PATCH | `/events/:eventId` | 管理セッション | 基本情報・通知設定変更 |
| PUT | `/events/:eventId/candidate-slots` | 管理セッション | 候補枠の差分更新 |
| POST | `/events/:eventId/finalization` | 管理セッション | 連続枠で日時確定 |
| DELETE | `/events/:eventId/finalization` | 管理セッション | 日時確定解除 |
| POST | `/events/:eventId/close` | 管理セッション | 回答受付停止 |
| POST | `/events/:eventId/reopen` | 管理セッション | 回答受付再開 |
| DELETE | `/events/:eventId` | 管理セッション | 論理削除 |
| POST | `/events/:eventId/email-verifications` | 管理セッション・回数制限 | 認証メール送信・再送 |
| GET | `/email-verifications/:token` | 公開・高強度トークン | 主催者メール認証 |

## 共通ルール

- 作成系・回答系では `Idempotency-Key` ヘッダーを必須とする。
- JSONエラーは `code`, `message`, `fieldErrors?`, `requestId` を返す。
- 公開レスポンスに主催者メール、秘密ハッシュ、配送情報を含めない。
- CORSはローカル開発URLと公開URLの許可リスト方式とし、任意Originを反射しない。


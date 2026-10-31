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

- イベント作成`POST /events`と回答登録`POST /events/:eventId/responses`では `Idempotency-Key` ヘッダーを必須とする。
- JSONエラーは `code`, `message`, `fieldErrors?`, `requestId` を返す。
- 公開レスポンスに主催者メール、秘密ハッシュ、配送情報を含めない。
- CORSはローカル開発URLと公開URLの許可リスト方式とし、任意Originを反射しない。

## 回答登録・編集（実装済み）

`POST /events/:eventId/responses`は16〜128文字の`Idempotency-Key`を必須とする。
`PATCH /responses/:responseId`は`Authorization: Bearer <editToken>`を必須とする。
両方とも以下の完全な回答をJSONで送る。候補枠は対象イベントの全枠を重複なく1回ずつ含める（PATCHも差分ではなく全件）。

```json
{
  "displayName": "参加者",
  "comment": "よろしくお願いします",
  "availability": [
    { "candidateSlotId": "00000000-0000-4000-8000-000000000001", "mark": "best" }
  ]
}
```

- `displayName`：trim後1〜80文字、`comment`：trim後0〜1000文字（省略不可）。
- `availability`：1〜720件、IDはUUID、markは`best | ok | maybe | ng`。
- UUIDは小文字へ、候補枠配列はID順へ正規化する。本文上限は128KiB。
- POSTは201で`{ response, editToken }`を返す。同一イベント・キー・正規化済み本文の再送は同じ回答IDと編集トークンを返す。回答編集後の再送では現在の回答内容を返す。受付停止・削除後は再送でもイベント状態のエラーになる。
- PATCHは200で`{ response }`だけを返す。同じ内容の更新では更新時刻・version・通知を変更しない。
- `response`は`id, displayName, comment, createdAt, updatedAt, availability`。公開GETの`responses`にもこの形で反映する。公開GETやPATCH応答に編集トークン・秘密ハッシュは含めない。
- 通知は主催者メール認証済みかつ通知ONの場合だけ、回答と同じDBトランザクションで予約する。このAPIの検証はメール配送の検証を含まない。

| 条件 | HTTP | code |
|---|---|---|
| POSTの冪等キー欠落・長さ不正 | 400 | IDEMPOTENCY_KEY_REQUIRED |
| JSON不正 | 400 | INVALID_JSON |
| 本文上限超過 | 413 | PAYLOAD_TOO_LARGE |
| 名前・コメント・候補枠形式不正 | 422 | VALIDATION_ERROR |
| 全候補枠と不一致 | 422 | INVALID_AVAILABILITY |
| イベント不明・削除済み | 404 | EVENT_NOT_FOUND |
| 受付停止 | 409 | EVENT_CLOSED |
| 異なる本文で冪等キー再利用 | 409 | IDEMPOTENCY_KEY_REUSED |
| 回答不明・不正ID・編集トークン欠落/不正 | 404 | RESPONSE_NOT_FOUND |
| レート制限 | 429 | RATE_LIMIT_EXCEEDED |
| 回答サービス未構成 | 503 | SERVICE_UNAVAILABLE |

422は`fieldErrors`も返す。編集認証の失敗は回答の存在を隠す404とする。
レート制限はPOST全体300回/分・イベント120回/10分、PATCH全体300回/分・回答60回/10分。429には`Retry-After`を付ける。

### Function環境設定とdevelopmentスモーク

`DATABASE_URL`に加え`KURUKURU_TOKEN_SECRET`が必須。秘密値は32文字以上の強いランダム値をFunction環境だけへ設定する（`VITE_`接頭辞を付けない）。未設定または32文字未満では起動を拒否する。
回答IDと秘密値からHMAC-SHA256で編集トークンを導出し、DBにはそのSHA-256ハッシュだけを保存する。秘密値を変更すると既存回答の再送トークンが変わり、保存済みハッシュと一致しなくなるため、継続して同じ値を使用する。

```bash
FUNCTION_URL=https://br-icy-dew-aowwun6d-kurukuruapi.compute.c-2.ap-southeast-1.aws.neon.tech/ npm run smoke:function
```

スモークは実データを作るためdevelopment専用URLを指定する。イベント作成・同一再送・異内容409、全枠bestの回答作成・同一再送、公開取得、1枠ngへのPATCH、公開取得への反映と秘密情報非公開を検証し、編集トークンはログへ出さない。作成したイベントID・回答IDだけを結果へ出す。同時実行・ロック・通知配送の検証ではない。実行結果は`docs/phase-log.md`に記録する。

# API契約 v0.1

ベースパス：`/api/v1`

| Method | Path | 認可 | 用途 |
|---|---|---|---|
| POST | `/events` | 公開・レート制限・冪等キー | イベントと候補枠を作成 |
| GET | `/events/:eventId` | 公開 | 公開可能なイベント・回答集計を取得 |
| POST | `/events/:eventId/responses` | 公開・レート制限・冪等キー | 回答登録と編集リンク発行 |
| PATCH | `/responses/:responseId` | 回答編集トークン | 回答編集 |
| POST | `/events/:eventId/admin/sessions` | 管理パスワード・レート制限 | 短命管理セッション発行 |
| GET | `/events/:eventId/admin` | 管理セッション | 非公開情報を含む管理状態取得 |
| PATCH | `/events/:eventId` | 管理セッション | 基本情報・通知設定変更 |
| PUT | `/events/:eventId/candidate-slots` | 管理セッション | 候補枠の差分更新 |
| POST | `/events/:eventId/finalization` | 管理セッション | 連続枠で日時確定 |
| DELETE | `/events/:eventId/finalization` | 管理セッション | 日時確定解除 |
| POST | `/events/:eventId/close` | 管理セッション | 回答受付停止 |
| POST | `/events/:eventId/reopen` | 管理セッション | 回答受付再開 |
| DELETE | `/events/:eventId` | 管理セッション | 論理削除 |
| POST | `/events/:eventId/email-verifications` | 管理セッション・回数制限 | 認証メール送信・再送 |
| GET | `/email-verifications/:token` | 公開・高強度トークン | 主催者メール認証 |
| POST | `/internal/notifications/drain` | ワーカーBearer秘密値 | 回答通知を最大10件配送 |

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

## 管理認証・基本管理（実装済み）

`POST /events/:eventId/admin/sessions`は`{ "password": "..." }`を受け取り、成功時に12時間有効の`sessionToken`、`expiresAt`、`event`を201で返す。トークンは強いランダム値を一度だけ返し、DBにはSHA-256ハッシュだけを保存する。全体60回/分、イベント10回/10分で制限する。

`GET /events/:eventId/admin`、`PATCH /events/:eventId`、`POST /events/:eventId/close`、`POST /events/:eventId/reopen`は`Authorization: Bearer <sessionToken>`を必須とする。管理操作は全体300回/分、イベント120回/10分で制限する。期限切れ、不正、別イベント用のセッション、イベント不明・削除済みは、存在を追加開示しない`404 ADMIN_ACCESS_DENIED`へ統一する。

セッショントークンまたは非公開管理情報を含む可能性がある全管理レスポンスは`Cache-Control: no-store`を返す。

管理状態は公開イベントの項目に`organizerEmail`、`organizerEmailVerified`、`notifyOnResponse`、`version`を加える。管理パスワード、セッションハッシュ、メール認証トークン、配送情報は返さない。

`PATCH /events/:eventId`は次の全項目を送る。タイトル、説明、主催者メールはtrimし、メールは小文字へ正規化して保存する。

```json
{
  "title": "更新後のタイトル",
  "description": "説明",
  "organizerEmail": "organizer@example.com",
  "notifyOnResponse": true
}
```

- `title`：trim後1〜120文字、`description`：trim後0〜2000文字、`organizerEmail`：有効なメール形式で254文字以内。
- 主催者メールが変わる場合は確認済み状態と旧確認リンクを失効させ、未送信・再試行待ちの回答通知を削除する。変更後は確認メールを再送するまで回答通知を作成・配送しない。
- メールが正規化後に同一なら確認済み状態と既存確認リンクを維持する。回答通知をONからOFFへ変える場合は未送信・再試行待ちの通知を削除する。
- 通知予約はイベントの通知世代を保持する。メール変更または通知OFFより前にワーカーが取得した通知は、送信失敗後に再試行へ戻さず破棄する。
- close済みイベントへのclose、openイベントへのreopenは成功扱いとし、`version`と`updatedAt`を変更しない。
- 管理APIのJSON本文上限は16KiB。入力不正は`422 VALIDATION_ERROR`、サービス未構成は`503 SERVICE_UNAVAILABLE`を返す。

## 管理ライフサイクル（実装済み）

次の操作も管理セッション、管理操作レート制限（全体300回/分・イベント120回/10分）、16KiB本文上限、`Cache-Control: no-store`を共通で適用する。

### 候補枠の全件置換

`PUT /events/:eventId/candidate-slots`は差分断片ではなく、更新後に残す候補枠の全件を送る。

```json
{
  "candidateSlots": [
    { "date": "2026-11-10", "slotIndexes": [18, 19, 20] }
  ]
}
```

- 候補日はISO日付、1〜20日、日付重複不可。各日は12〜47の整数枠を1〜36件、重複なく指定する（最大720枠）。
- 日付・枠順へ正規化し、既存の同一枠はIDと回答を保持する。追加枠は既存の全回答へ`ng`を補完し、削除枠の回答可否は候補枠とともに削除する。
- 正規化後に同一なら`version`と`updatedAt`を変更しない。
- 確定範囲の枠を取り除く更新は`409 EVENT_FINALIZED`。先に確定を解除する。

### 日時確定と解除

`POST /events/:eventId/finalization`は同一日の連続した候補枠を確定する。`endSlot`は終了境界（exclusive）で、次の例は18・19・20番枠を確定する。

```json
{
  "date": "2026-11-10",
  "startSlot": 18,
  "endSlot": 21
}
```

- `startSlot`は12〜47、`endSlot`は13〜48かつ`startSlot`より大きい整数。
- `[startSlot, endSlot)`の全枠がその日の候補として存在しない場合は`422 INVALID_FINALIZATION`と`fieldErrors.finalization`を返す。
- 同じ確定を繰り返しても`version`と`updatedAt`を変更しない。確定しても回答受付状態は自動変更しない。
- `DELETE /events/:eventId/finalization`は確定を解除する。未確定状態への再実行も成功し、状態を変更しない。成功時はいずれも`AdminEvent`を返す。

### イベントの論理削除

`DELETE /events/:eventId`はイベントを論理削除し、同じトランザクションでそのイベントの全管理セッションを失効させる。成功時は本文なしの`204`。以後の公開取得ではイベント不明、管理アクセスでは`404 ADMIN_ACCESS_DENIED`となる。

### Function環境設定とdevelopmentスモーク

`DATABASE_URL`に加え`KURUKURU_TOKEN_SECRET`が必須。秘密値は32文字以上の強いランダム値をFunction環境だけへ設定する（`VITE_`接頭辞を付けない）。未設定または32文字未満では起動を拒否する。
回答IDと秘密値からHMAC-SHA256で編集トークンを導出し、DBにはそのSHA-256ハッシュだけを保存する。秘密値を変更すると既存回答の再送トークンが変わり、保存済みハッシュと一致しなくなるため、継続して同じ値を使用する。

```bash
FUNCTION_URL=https://br-icy-dew-aowwun6d-kurukuruapi.compute.c-2.ap-southeast-1.aws.neon.tech/ npm run smoke:function
```

スモークは実データを作るためdevelopment専用URLを指定する。イベント作成・同一再送・異内容409、全枠bestの回答作成・同一再送、公開取得、1枠ngへのPATCH、公開取得への反映と秘密情報非公開を検証し、編集トークンはログへ出さない。作成したイベントID・回答IDだけを結果へ出す。同時実行・ロック・通知配送の検証ではない。実行結果は`docs/phase-log.md`に記録する。

## 主催者メール確認・回答通知（実装済み）

`POST /events/:eventId/email-verifications`は管理Bearer認証を必須とし、24時間有効の確認トークンを生成する。DBにはSHA-256ハッシュだけを保存し、再送時は既存トークンを無効化する。送信時は`202 { "status": "sent" }`、確認済みなら送信せず`200 { "status": "already-verified" }`を返す。管理操作制限に加え、全体60回/分・イベント5回/10分で制限する。

`GET /email-verifications/:token`は有効な未削除イベントのトークンを確認し、`200 { "eventId": "...", "status": "verified" }`を返す。同じ有効トークンの再実行は成功する。無効・期限切れ・削除済みは`404 EMAIL_VERIFICATION_NOT_FOUND`へ統一する。両ルートは`Cache-Control: no-store`を返す。

Resendは`Kurukuru <no-reply@notify.kurukuru-app.jp>`から送信し、Reply-Toは設定しない。メール設定が不足する場合、既存APIは起動したままメール関連ルートだけを`503 SERVICE_UNAVAILABLE`とする。配信事業者の失敗本文は公開せず、確認メールの配信失敗は`502 EMAIL_DELIVERY_FAILED`へ固定する。

通知は回答保存トランザクションで作成済みのアウトボックスを`POST /internal/notifications/drain`が最大10件ずつ処理する。`Authorization: Bearer <KURUKURU_NOTIFICATION_WORKER_SECRET>`が一致しない場合は存在を隠す`404 NOT_FOUND`、構成不足は`503 SERVICE_UNAVAILABLE`。claimは`FOR UPDATE SKIP LOCKED`を使用し、15分以上`sending`の行を回収する。失敗は1・2・4分…の指数バックオフ（最大6時間）で再試行し、Resendへアウトボックスの冪等キーを渡す。

Function環境には次を設定する（すべて`VITE_`接頭辞なし）。

- `RESEND_API_KEY`
- `KURUKURU_MAIL_FROM=Kurukuru <no-reply@notify.kurukuru-app.jp>`
- `KURUKURU_PUBLIC_BASE_URL=https://kurukuru-app.jp`
- `KURUKURU_NOTIFICATION_WORKER_SECRET`（強いランダム値）

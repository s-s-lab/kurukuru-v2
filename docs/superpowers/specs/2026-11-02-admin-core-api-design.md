# Admin Core API Design

## Intent

主催者用管理画面が、作成時の管理パスワードを毎回保持せずにイベントの管理状態を読み取り、基本情報と回答受付状態を安全に変更できるようにする。参加者向け公開APIと管理者向け認可境界を分離し、後続の候補日時編集・日時確定・削除・メール認証の共通土台とする。

## Goals

- 管理パスワードを検証し、12時間有効の短命管理セッションを発行する。
- セッショントークンは一度だけ返し、DBにはSHA-256ハッシュだけを保存する。
- Bearer認証済み主催者が、非公開情報を含む管理状態を取得できる。
- タイトル、説明、回答通知設定を更新できる。
- 回答受付を停止・再開できる。
- 更新処理はイベント行をロックし、`version`と`updated_at`を更新する。
- 削除済みイベント、期限切れ／不正セッション、誤ったパスワードを安全な固定エラーへ写像する。

## Non-goals

- 候補日時編集、開催日時の確定・解除、イベント削除。
- 主催者メールアドレス変更、メール認証、通知メール配送。
- 主催者管理画面のフロントエンド実装。
- セッションの明示ログアウト、複数端末一覧、セッション失効管理。

## Constraints

- 既存の`admin_sessions`、`events.admin_secret_hash`、`events.version`を使用し、DBマイグレーションを追加しない。
- 管理パスワード、セッショントークン、保存済みハッシュをログ・公開レスポンス・エラー本文へ含めない。
- 管理セッション発行は全体60回/分、イベント単位10回/10分で制限する。
- 管理変更は全体300回/分、イベント単位120回/10分で制限する。
- JSON本文は16KiBを上限とする。
- イベントIDとセッション認証の不一致は同じ`ADMIN_ACCESS_DENIED`（404）にし、別イベントのセッションで存在確認できないようにする。

## API

### `POST /api/v1/events/:eventId/admin/sessions`

Request: `{ "password": "..." }`

Success `201`:

```json
{
  "sessionToken": "opaque-token",
  "expiresAt": "2026-11-02T12:00:00.000Z",
  "event": { "...": "AdminEvent" }
}
```

- パスワードはtrimせず、そのまま検証する。
- 空または128文字超は`422 VALIDATION_ERROR`。
- イベント不明・削除済み・パスワード不一致は`404 ADMIN_ACCESS_DENIED`。

### `GET /api/v1/events/:eventId/admin`

`Authorization: Bearer <sessionToken>`を必須とする。成功時は`AdminEvent`を返す。

### `PATCH /api/v1/events/:eventId`

Request:

```json
{
  "title": "更新後のタイトル",
  "description": "説明",
  "notifyOnResponse": true
}
```

- 3フィールドをすべて必須とし、タイトルはtrim後1〜120文字、説明はtrim後0〜2000文字。
- 主催者メールはこの段階では変更しない。
- 成功時は更新後の`AdminEvent`を返す。

### `POST /api/v1/events/:eventId/close`

Openイベントをclosedへ変更し、更新後の`AdminEvent`を返す。既にclosedなら状態・version・updated_atを変更せず同じ状態を返す。

### `POST /api/v1/events/:eventId/reopen`

Closedイベントをopenへ変更し、更新後の`AdminEvent`を返す。既にopenなら状態・version・updated_atを変更せず同じ状態を返す。

## `AdminEvent`

公開イベントの情報に、`organizerEmail`、`organizerEmailVerified`、`notifyOnResponse`、`version`を加える。パスワードハッシュ、セッションハッシュ、メール認証トークン、配送情報は含めない。

## Architecture

- `functions/admin/service.ts`: 公開型、コマンド、エラー、サービス境界。
- `functions/admin/admin-service.ts`: パスワード検証、トークン生成・ハッシュ化、12時間の有効期限、入力をリポジトリへ渡すユースケース。
- `functions/admin/repository.ts`: セッション作成、管理状態取得、基本情報更新、受付状態変更の永続化契約。
- `functions/admin/postgres-admin-repository.ts`: トランザクション、行ロック、セッション有効期限・イベント一致の検証、AdminEventの読取り。
- `functions/admin/validation.ts`: ログインと基本情報更新のZodスキーマ。
- `functions/app.ts`: HTTP、本文上限、Bearer抽出、レート制限、エラー写像。
- `functions/runtime.ts`: 既存Poolと秘密処理を管理サービスへ接続する。

## Approaches considered

1. 管理パスワードを各管理APIへ毎回送る方式は実装が短いが、ブラウザが秘密を繰り返し保持・送信するため採用しない。
2. 署名付き自己完結トークンはDB照会を減らせるが、既存`admin_sessions`を使わず、個別失効やイベント照合が複雑になるため採用しない。
3. ランダムなDBセッション方式を採用する。既存スキーマと一致し、トークンをハッシュ保存でき、期限・イベント境界を各操作で一貫して検証できる。

## Success criteria

- 管理認証・状態取得・更新・close/reopenが単体テストとPostgreSQL統合テストで動作する。
- 別イベントのセッション、期限切れセッション、削除済みイベントで変更されない。
- 再度close/reopenしてもversionが増えない。
- API応答とログに秘密値が現れない。

# 回答登録・編集API 設計

## 目的

参加者がイベントの候補枠へ回答し、初回応答で受け取る編集専用トークンを使って、パスワードなしで自分の回答を更新できるようにする。回答保存と主催者通知の予約は同一トランザクションで確定し、通知障害によって回答を失わない。

## API

- `POST /api/v1/events/:eventId/responses`
  - `Idempotency-Key`必須。
  - 本文は`displayName`、`comment`、全候補枠分の`availability`を受け取る。
  - 201で`response`と`editToken`を返す。
  - 同じ冪等キー・同じ本文の再送は、同じ回答と同じ編集トークンを返す。
- `PATCH /api/v1/responses/:responseId`
  - `Authorization: Bearer <editToken>`必須。
  - 本文は新規登録と同じ回答内容を受け取る。
  - 200で更新後の`response`を返す。編集トークンは返さない。
  - 保存済み内容と同じ場合は更新時刻・バージョン・通知アウトボックスを変更しない。

イベントが存在しない場合は404、受付停止中は409、候補枠の不足・重複・別イベント混入は422、編集トークン不正は404として扱い、回答の存在を第三者へ知らせない。

## データと秘密情報

- `responses`へ`version integer NOT NULL DEFAULT 1`を追加する。
- 編集トークンはFunction環境の`KURUKURU_TOKEN_SECRET`と回答IDからHMAC-SHA256で決定的に導出する。
- `responses.edit_secret_hash`にはSHA-256ハッシュだけを保存し、平文トークンはDBへ保存しない。
- 新規回答の冪等応答は回答IDを保存し、再送時は回答IDから同じ編集トークンを再生成する。
- 更新通知のアウトボックス冪等キーは`response-updated:<responseId>:<version>`、新規通知は`response-created:<responseId>`とする。

## トランザクション

新規登録では、冪等キー取得、イベント状態確認、候補枠完全一致確認、回答・回答枠登録、条件付き通知アウトボックス登録、冪等応答保存を1トランザクションで行う。

更新では、回答行を`FOR UPDATE`で取得し、トークンハッシュを照合する。候補枠完全一致を確認し、内容が変わる場合だけ回答更新、回答枠置換、バージョン加算、条件付き通知アウトボックス登録を1トランザクションで行う。

通知アウトボックスは、`events.organizer_email_verified_at IS NOT NULL`かつ`events.notify_on_response = true`の場合だけ作成する。

## 入力制約と負荷対策

- `displayName`: trim後1〜80文字
- `comment`: trim後0〜1000文字
- `availability`: 1〜720件、`candidateSlotId`はUUID、`mark`は`best | ok | maybe | ng`
- 回答本文上限: 128KiB
- 新規回答: 全体1分300回、イベント単位10分120回
- 回答更新: 全体1分300回、回答単位10分60回

候補枠はイベントの全候補枠を重複なく1回ずつ含める。これにより未送信枠の解釈を持たず、公開集計を一意にする。

## テスト

- HTTP契約: 成功、冪等キー欠落、本文上限、入力不正、受付停止、トークン不正、レート制限。
- サービス: トークン導出・ハッシュ保存、平文非永続化、リクエストハッシュの正規化。
- PostgreSQL統合: 新規・同時再送・異内容競合・候補枠完全一致・通知条件・更新・無変更更新・不正トークン・ロールバック。
- development Functionスモーク: イベント作成、回答作成、冪等再送、公開取得、回答更新、公開取得反映。


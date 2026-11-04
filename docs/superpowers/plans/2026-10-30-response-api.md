# 回答登録・編集API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 参加者が全候補枠へ回答し、編集専用トークンで安全に更新できるAPIを、冪等処理と通知アウトボックス込みで実装する。

**Architecture:** 既存のHono→サービス→PostgreSQLリポジトリの境界を維持する。編集トークンはFunction秘密鍵と回答IDからHMACで導出し、DBにはハッシュだけを保存する。新規・更新とも回答保存と条件付き通知アウトボックスを同一トランザクションにする。

**Tech Stack:** TypeScript 6、Hono、Zod、Node.js 24 crypto、PostgreSQL 18、Vitest

**Spec:** `docs/superpowers/specs/2026-10-30-response-api-design.md`

## Global Constraints

- 既存のNeon `development`ブランチだけを検証に使い、`main` DBを変更しない。
- 公開レスポンスへ主催者メール、管理パスワード、各種秘密ハッシュ、通知配送情報を含めない。
- 編集トークンの平文をDBへ保存しない。
- 回答保存と通知アウトボックス作成は同一トランザクションで行う。
- 候補枠20日、1日36枠、参加者100人を処理できる上限とクエリ構造にする。
- 新しい本番コードは、先に失敗するテストを確認してから最小実装する。

---

### Task 1: 回答契約・検証・トークン導出

**Files:**
- Create: `functions/responses/service.ts`
- Create: `functions/responses/validation.ts`
- Create: `functions/responses/response-service.ts`
- Create: `functions/responses/response-service.test.ts`
- Modify: `functions/security/secrets.ts`
- Modify: `functions/security/secrets.test.ts`

**Interfaces:**
- Consumes: `AvailabilityMark`と`PublicResponse` from `functions/events/service.ts`
- Produces: `ResponseService.createResponse`、`ResponseService.updateResponse`、`deriveResponseEditToken(secret, responseId)`、正規化済み`responseRequestSchema`

- [ ] **Step 1: 失敗テストを書く**

  `deriveResponseEditToken`が同じ秘密鍵・回答IDで同じ43文字のbase64url値を返し、回答IDまたは秘密鍵が変われば異なる値になることをリテラル比較ではなく関係として検証する。`responseRequestSchema`は名前・コメントをtrimし、availabilityを`candidateSlotId`順へ正規化し、重複ID、不正mark、721件を拒否する。サービスはリポジトリへ平文トークンを渡さず`editTokenHash`だけを渡し、返却値に平文トークンを含める。

- [ ] **Step 2: REDを確認する**

  Run: `npm test -- functions/security/secrets.test.ts functions/responses/response-service.test.ts`

  Expected: 新しい関数・モジュールが未定義のためFAIL。

- [ ] **Step 3: 最小実装を書く**

  `deriveResponseEditToken`は`createHmac('sha256', secret).update('response-edit:' + responseId).digest('base64url')`とする。サービスは正規化済みリクエストをSHA-256でハッシュし、リポジトリから返された回答IDでトークンを導出する。更新は受け取ったトークンをハッシュ化してリポジトリへ渡す。

- [ ] **Step 4: GREENと回帰を確認する**

  Run: `npm test -- functions/security/secrets.test.ts functions/responses/response-service.test.ts`

  Expected: 対象テストが全件PASS。

- [ ] **Step 5: コミットする**

  ```bash
  git add functions/responses functions/security/secrets.ts functions/security/secrets.test.ts
  git commit -m "feat: define response service contract"
  ```

### Task 2: PostgreSQL回答永続化と通知整合性

**Files:**
- Create: `db/migrations/0003_response_version.sql`
- Create: `functions/responses/repository.ts`
- Create: `functions/responses/postgres-response-repository.ts`
- Create: `functions/responses/postgres-response-repository.integration.test.ts`
- Modify: `src/db/migration.test.ts`

**Interfaces:**
- Consumes: Task 1の`CreateResponsePersistenceInput`、`UpdateResponsePersistenceInput`
- Produces: `PostgresResponseRepository.createResponse`と`updateResponse`

- [ ] **Step 1: マイグレーションと統合の失敗テストを書く**

  `responses.version`が1から始まること、新規回答が全候補枠を保存すること、同じ冪等キーの同時再送が同じ回答を返すこと、異内容再利用が`IdempotencyConflictError`となること、候補枠不足・重複・別イベント枠を`InvalidAvailabilityError`とすることを検証する。認証済み・通知ONだけが`created`アウトボックスを作ることも検証する。

  更新では正しいトークンハッシュだけが成功し、内容変更時にversionを1増やして`updated`アウトボックスを1件作り、同一内容ではversion・updated_at・アウトボックス件数が変化しないことを検証する。削除済み・受付停止イベントと不正トークンも検証する。

- [ ] **Step 2: REDを確認する**

  Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kurukuru_test npm test -- functions/responses/postgres-response-repository.integration.test.ts`

  Expected: マイグレーションまたはリポジトリが未実装のためFAIL。

- [ ] **Step 3: マイグレーションと最小リポジトリを実装する**

  `0003_response_version.sql`は`ALTER TABLE responses ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version >= 1)`だけを追加する。新規登録の冪等scopeは`create-response:<eventId>`とし、保存応答に編集トークンを含めない。候補枠は`SELECT ... FOR SHARE`でイベントの全件を取得し、入力ID集合と完全一致を確認する。更新は回答とイベントを`FOR UPDATE`で取得し、変更時だけavailabilityを置換する。

- [ ] **Step 4: GREENと回帰を確認する**

  Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kurukuru_test npm test -- functions/responses/postgres-response-repository.integration.test.ts src/db/migration.test.ts`

  Expected: 対象テストが全件PASS。

- [ ] **Step 5: コミットする**

  ```bash
  git add db/migrations/0003_response_version.sql functions/responses src/db/migration.test.ts
  git commit -m "feat: persist responses and notification outbox"
  ```

### Task 3: Hono回答APIとランタイム配線

**Files:**
- Modify: `functions/app.ts`
- Modify: `functions/app.test.ts`
- Modify: `functions/runtime.ts`
- Modify: `functions/runtime.test.ts`

**Interfaces:**
- Consumes: Task 1の`ResponseService`、Task 2の`PostgresResponseRepository`
- Produces: `POST /api/v1/events/:eventId/responses`と`PATCH /api/v1/responses/:responseId`

- [ ] **Step 1: HTTP契約の失敗テストを書く**

  POSTの201、同一キー再送、冪等キー欠落400、UUID不正404、入力不正422、本文128KiB超413、受付停止409、候補枠不整合422、全体・イベント単位429を検証する。PATCHの200、Bearer欠落・不正404、UUID不正404、入力不正422、本文上限、全体・回答単位429を検証する。エラー本文は`code`、`message`、`requestId`を維持する。

- [ ] **Step 2: REDを確認する**

  Run: `npm test -- functions/app.test.ts functions/runtime.test.ts`

  Expected: 回答ルートとランタイム配線がないためFAIL。

- [ ] **Step 3: 最小HTTP実装を書く**

  共通の128KiB JSON読込、Zod fieldErrors整形、Bearer抽出を小さな関数へ分ける。POSTは全体`create-response-global` 300/60秒とイベント`create-response-event` 120/600秒、PATCHは全体`update-response-global` 300/60秒と回答`update-response-id` 60/600秒を適用する。リポジトリエラーを404/409/422へ明示的に写像する。`createRuntimeApp`は32文字以上の`KURUKURU_TOKEN_SECRET`を必須にしてResponseServiceを注入する。

- [ ] **Step 4: GREENと全回帰を確認する**

  Run: `npm test -- functions/app.test.ts functions/runtime.test.ts && npm test -- --run`

  Expected: 全テストPASS（ローカルDB未指定時の統合テストskipを除く）。

- [ ] **Step 5: コミットする**

  ```bash
  git add functions/app.ts functions/app.test.ts functions/runtime.ts functions/runtime.test.ts
  git commit -m "feat: expose response create and edit APIs"
  ```

### Task 4: スモークテスト・文書・総合検証

**Files:**
- Modify: `scripts/smoke-event-api.mjs`
- Modify: `docs/api-contract.md`
- Modify: `docs/phase-log.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: Task 3の公開API
- Produces: development Functionで再実行可能な回答APIスモークテストと運用記録

- [ ] **Step 1: スモークテストを回答フローへ拡張する**

  イベント作成後に全候補枠を`best`で回答し、同じ冪等キー再送で同じ回答ID・編集トークンになること、公開GETへ回答が反映されること、PATCHで1枠を`ng`へ変えた後の公開GETへ反映されることをassertする。秘密トークンが公開GETに含まれないこともassertする。

- [ ] **Step 2: 文書と環境変数例を更新する**

  `KURUKURU_TOKEN_SECRET`の用途と32文字以上の要件、回答APIの入力・成功応答・代表エラー、development DBだけを使用した検証結果を記録する。

- [ ] **Step 3: 全検証を実行する**

  Run: `npm run lint && npm test -- --run && npm run build && npm run build:function && npm run test:function-bundle`

  Expected: exit 0、Lintエラー0、ユニットテスト失敗0、両ビルド成功。

- [ ] **Step 4: development環境で検証する**

  `0003_response_version.sql`をNeon developmentブランチへ適用し、Functionをdevelopmentへ更新配置して`npm run smoke:function`を実行する。main DBと本番公開設定は変更しない。

- [ ] **Step 5: コミットする**

  ```bash
  git add scripts/smoke-event-api.mjs docs/api-contract.md docs/phase-log.md .env.example
  git commit -m "docs: verify response API flow"
  ```

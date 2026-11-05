# Kurukuru コンパクト公開ボード再設計 実装計画

> 対象仕様: `docs/superpowers/specs/2026-11-05-compact-public-board-redesign.md`

## 実装方針

既存 API とデータモデルを維持し、画面構成を先に再設計する。各項目は失敗するテストを先に追加し、最小実装、対象テスト、全体検証の順で進める。ユーザー指定により、このブランチ内で順次実装する。

### Task 1: 作成画面の一画面化

**対象:**
- `src/features/event-create/EventCreateFlow.test.tsx`
- `src/features/event-create/EventCreateFlow.tsx`
- `src/features/event-create/BasicInformationStep.tsx`
- `src/features/event-create/CandidateTimeStep.tsx`
- `src/pages/HomePage.tsx`
- `src/styles.css`

1. 進捗表示と「次へ」「戻る」がなく、基本情報・2か月カレンダー・時間表・作成ボタンが同時表示されることをテストする。
2. 基本情報と候補日時を一度に検証するテストを追加する。
3. フィールドと候補日時編集を一つのフォームへ統合する。
4. PC 2カラム、モバイル縦積みのコンパクトレイアウトを実装する。
5. 対象テストを通し、不要になった確認ステップ依存を除く。

### Task 2: 公開回答ボードの表示

**対象:**
- `src/features/event-response/PublicAvailabilityBoard.tsx`（新規）
- `src/features/event-response/PublicAvailabilityBoard.test.tsx`（新規）
- `src/features/event-response/ParticipantResponseForm.tsx`
- `src/features/event-response/AvailabilityResponseGrid.tsx`
- `src/features/event-response/AvailabilityResponseGrid.test.tsx`
- `src/styles.css`

1. 回答者を行、候補時間を列とし、全回答記号とコメントを表示するテストを追加する。
2. 回答がない状態と受付終了状態をテストする。
3. 公開ボードコンポーネントを実装し、回答者名列を固定する。
4. `AvailabilityResponseGrid` から時間帯別集計を削除し、関連テストを更新する。
5. 公開ページの概要とボードをコンパクトに統合する。

### Task 3: 回答モーダル

**対象:**
- `src/features/event-response/ResponseEditorModal.tsx`（新規）
- `src/features/event-response/ResponseEditorModal.test.tsx`（新規）
- `src/features/event-response/ParticipantResponseForm.tsx`
- `src/pages/ParticipantEventPage.test.tsx`
- `src/styles.css`

1. 「回答を追加」でモーダルが開き、名前・コメント・時間表を編集できるテストを追加する。
2. 保存、キャンセル、Escape、閉じる後のフォーカス復帰をテストする。
3. 既存の回答編集トークンがある場合に「自分の回答を編集」と表示し、既存ドラフトを使うことをテストする。
4. 編集フォームをモーダルへ移し、公開ボードを背面に維持する。

### Task 4: 候補日時専用の管理画面

**対象:**
- `src/pages/AdminEventPage.test.tsx`
- `src/pages/AdminEventPage.tsx`
- `src/features/event-admin/AdminCandidateEditor.tsx`
- `src/styles.css`

1. 未認証時は管理パスワード入力、認証後は候補日時編集と公開ボードへのリンクだけを表示するテストを追加する。
2. 回答一覧、設定、日時確定、メール確認、削除が表示されないことをテストする。
3. 既存認証・セッション・候補更新 API を残してページを簡素化する。
4. 候補更新後の再取得とエラー表示を確認する。

### Task 5: 通知メールの公開ボード誘導

**対象:**
- `functions/mail/templates.test.ts`
- `functions/mail/templates.ts`

1. 回答通知メールが `/#/events/:id` を使い、`/admin` を含まないテストへ変更する。
2. 本文と CTA を「公開回答ボードを開く」へ変更する。
3. HTML エスケープと冪等キーの既存テストを維持する。

### Task 6: 作成時の確認メール自動送信

**対象:**
- `functions/events/event-service.test.ts`
- `functions/events/event-service.ts`
- `functions/events/service.ts`
- `functions/events/repository.ts`
- `functions/events/postgres-event-repository.ts`
- `functions/app.ts`
- `functions/runtime.ts`
- 関連するルート・統合テスト

1. 通知 ON の作成時だけ確認メール送信を試みるテストを追加する。
2. 通知 OFF の場合は確認トークン作成・メール送信を行わないテストを追加する。
3. 送信失敗時もイベント作成結果を返すテストを追加する。
4. イベント作成をコミットした後にベストエフォートで送信する構成へ変更する。
5. 冪等再実行で重複送信しない条件をテスト・実装する。

### Task 7: 仕上げと互換性確認

**対象:**
- `src/styles.css`
- `README.md` または該当運用文書
- 既存 E2E / UI テスト

1. PC、タブレット、スマートフォン幅でレイアウトを確認する。
2. 旧公開 URL、旧管理 URL、既存回答編集トークンの動作を確認する。
3. `npm test`、lint、型検査、ビルドを実行する。
4. ローカルでイベント作成から回答編集、候補日時編集まで通し確認する。
5. 差分を自己レビューし、機密情報・デバッグ出力・不要コードがないことを確認する。

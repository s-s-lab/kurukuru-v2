import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AdminEvent } from '../../../functions/admin/service';
import { AdminEventSettings } from './AdminEventSettings';

const event: AdminEvent = {
  id: '11111111-1111-4111-8111-111111111111', title: '11月の定例',
  description: '都合のよい日時を教えてください。', organizerEmail: 'owner@example.com',
  organizerEmailVerified: true, notifyOnResponse: true, status: 'open', finalization: null,
  version: 1, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  candidateSlots: [], responses: [],
};

function renderSettings(overrides: Partial<Parameters<typeof AdminEventSettings>[0]> = {}) {
  const props = {
    event,
    onSave: vi.fn(),
    isSaving: false,
    saveMessage: '',
    ...overrides,
  };
  return { ...render(<AdminEventSettings key={props.event.version} {...props} />), props };
}

describe('organizer event settings', () => {
  afterEach(cleanup);

  it('validates the title next to its field before saving', async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    const title = screen.getByLabelText('イベント名');
    await user.clear(title);
    await user.click(screen.getByRole('button', { name: '変更を保存' }));

    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAccessibleDescription('イベント名を入力してください。');
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('submits normalized basic information and notification choice', async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    const title = screen.getByLabelText('イベント名');
    const description = screen.getByLabelText('説明');
    const organizerEmail = screen.getByLabelText('主催者メールアドレス');
    await user.clear(title);
    await user.type(title, '  更新後の定例  ');
    await user.clear(description);
    await user.type(description, '  新しい説明  ');
    await user.clear(organizerEmail);
    await user.type(organizerEmail, '  NEW-OWNER@Example.COM  ');
    await user.click(screen.getByLabelText('回答が届いたらメールで通知する'));
    await user.click(screen.getByRole('button', { name: '変更を保存' }));

    expect(props.onSave).toHaveBeenCalledWith({
      title: '更新後の定例', description: '新しい説明',
      organizerEmail: 'new-owner@example.com', notifyOnResponse: false,
    });
  });

  it('validates the organizer email before saving', async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();
    const organizerEmail = screen.getByLabelText('主催者メールアドレス');
    await user.clear(organizerEmail);
    await user.type(organizerEmail, 'invalid-email');
    await user.click(screen.getByRole('button', { name: '変更を保存' }));

    expect(organizerEmail).toHaveAttribute('aria-invalid', 'true');
    expect(organizerEmail).toHaveAccessibleDescription('有効なメールアドレスを入力してください。');
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('disables only the settings save while it is pending', () => {
    renderSettings({ isSaving: true });
    expect(screen.getByRole('button', { name: '保存しています…' })).toBeDisabled();
  });

  it('resynchronizes its draft after a returned event replaces the prop', () => {
    const { rerender, props } = renderSettings();
    rerender(<AdminEventSettings key={2} {...props}
      event={{ ...event, title: 'サーバー更新後', version: 2 }} />);
    expect(screen.getByLabelText('イベント名')).toHaveValue('サーバー更新後');
  });
});

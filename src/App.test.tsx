import { render, screen } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('Kurukuruの入口', () => {
  it('サービスの価値とイベント作成導線を表示する', () => {
    render(
      <HashRouter>
        <App />
      </HashRouter>,
    );

    expect(screen.getByRole('heading', { name: '時間帯をなぞるだけ。' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '日程調整を作成' })).toHaveAttribute(
      'href',
      '#/events/new',
    );
  });
});

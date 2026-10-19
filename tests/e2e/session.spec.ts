import { test, expect, type Page } from '@playwright/test';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import pg from 'pg';
import type { RoomState } from '../../packages/shared/src/room';
const base = 'http://localhost:3001/api',
  workspace = '20000000-0000-0000-0000-000000000001';
let boardId: string, tokens: Record<string, string>, users: any[];
type Client = {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  state?: RoomState;
  errors: string[];
  socketId?: string;
};
const clients: Client[] = [];
const send = (client: Client, command: any) =>
  client.provider.sendStateless(
    JSON.stringify({ type: 'room-command', command }),
  );
async function connect(role: string): Promise<Client> {
  const doc = new Y.Doc(),
    client = { doc, errors: [] } as unknown as Client;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Room sync timeout')),
      10000,
    );
    client.provider = new HocuspocusProvider({
      url: 'ws://localhost:1234',
      name: `board:${boardId}`,
      token: tokens[role],
      document: doc,
      WebSocketPolyfill: WebSocket,
      onSynced: ({ state }) => {
        if (state) {
          clearTimeout(timer);
          resolve();
        }
      },
      onStateless: ({ payload }) => {
        const message = JSON.parse(payload);
        if (message.type === 'room-state') client.state = message.state;
        if (message.type === 'room-error') client.errors.push(message.message);
        if (message.type === 'room-hello') client.socketId = message.socketId;
      },
      onAuthenticationFailed: ({ reason }) => {
        clearTimeout(timer);
        reject(new Error(reason));
      },
    });
  });
  clients.push(client);
  send(client, { action: 'subscribe' });
  await expect.poll(() => !!client.state && !!client.socketId).toBe(true);
  return client;
}
async function login(page: Page, role: string) {
  await page.addInitScript(
    (id) => localStorage.setItem('modelboard:last-board', id),
    boardId,
  );
  await page.goto('/');
  await page.getByRole('button').filter({ hasText: role }).click();
  await expect(page.locator('.connection-status')).toHaveText('connected');
  await page
    .getByRole('button', { name: 'Совместная работа', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Слушать', exact: true }),
  ).toBeEnabled();
}
const section = async (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'Разделы совместной работы' })
    .getByRole('button', { name, exact: true })
    .click();
test.beforeEach(async ({ request }) => {
  users = await (await request.get(`${base}/auth/dev-users`)).json();
  tokens = {};
  for (const role of ['OWNER', 'EDITOR', 'VIEWER', 'COMMENTER'])
    tokens[role] = (
      await (
        await request.post(`${base}/auth/dev-login`, {
          data: { userId: users.find((u) => u.role === role).id },
        })
      ).json()
    ).token;
  const response = await request.post(
    `${base}/workspaces/${workspace}/boards`,
    {
      headers: { Authorization: `Bearer ${tokens.OWNER}` },
      data: { name: `Session acceptance ${Date.now()}` },
    },
  );
  expect(response.ok()).toBe(true);
  boardId = (await response.json()).id;
});
test.afterEach(async ({ request }) => {
  for (const client of clients.splice(0)) {
    client.provider.destroy();
    client.doc.destroy();
  }
  await request.delete(`${base}/boards/${boardId}`, {
    headers: { Authorization: `Bearer ${tokens.OWNER}` },
  });
});
test('server serializes votes, rejects forged readonly controls and restores durable session without presenter or call presence', async () => {
  const owner = await connect('OWNER'),
    viewer = await connect('VIEWER'),
    secondTab = await connect('VIEWER'),
    editor = await connect('EDITOR');
  send(viewer, {
    action: 'music-play',
    role: 'OWNER',
    userId: users.find((u) => u.role === 'OWNER').id,
  });
  await expect.poll(() => viewer.errors.length).toBe(1);
  expect(owner.state!.music.playing).toBe(false);
  send(owner, {
    action: 'poll-create',
    question: 'Ready?',
    options: ['Yes', 'No'],
  });
  await expect.poll(() => viewer.state!.poll?.question).toBe('Ready?');
  const pollId = owner.state!.poll!.id;
  send(viewer, { action: 'poll-vote', pollId, option: 0 });
  send(editor, { action: 'poll-vote', pollId, option: 1 });
  await expect.poll(() => Object.keys(owner.state!.poll!.votes).length).toBe(2);
  send(secondTab, { action: 'poll-vote', pollId, option: 1 });
  await expect
    .poll(
      () => owner.state!.poll!.votes[users.find((u) => u.role === 'VIEWER').id],
    )
    .toBe(1);
  expect(Object.keys(owner.state!.poll!.votes)).toHaveLength(2);
  send(owner, { action: 'poll-close', pollId });
  await expect.poll(() => viewer.state!.poll!.closed).toBe(true);
  send(viewer, { action: 'poll-vote', pollId, option: 0 });
  await expect.poll(() => viewer.errors.length).toBe(2);
  send(owner, {
    action: 'music-select',
    source: { kind: 'builtin', value: 'focus' },
  });
  send(owner, { action: 'timer-start', durationMs: 60000 });
  send(owner, { action: 'meeting-url', url: 'https://example.com/meeting' });
  send(owner, { action: 'presentation-claim' });
  send(viewer, { action: 'call-join' });
  await expect.poll(() => owner.state!.participants.length).toBe(1);
  await expect
    .poll(() => owner.state!.presenter?.socketId)
    .toBe(owner.socketId);
  const pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://modelboard:modelboard@localhost:5432/modelboard',
  });
  try {
    await expect
      .poll(
        async () =>
          (
            await pool.query(
              'SELECT state FROM board_sessions WHERE board_id=$1',
              [boardId],
            )
          ).rows[0]?.state?.meetingUrl,
      )
      .toBe('https://example.com/meeting');
    const stored = (
      await pool.query('SELECT state FROM board_sessions WHERE board_id=$1', [
        boardId,
      ])
    ).rows[0].state;
    expect(stored.presenter).toBeUndefined();
    expect(stored.participants).toBeUndefined();
  } finally {
    await pool.end();
  }
  owner.provider.destroy();
  owner.doc.destroy();
  clients.splice(clients.indexOf(owner), 1);
  await expect.poll(() => editor.state!.presenter).toBe(null);
  for (const client of clients.splice(0)) {
    client.provider.destroy();
    client.doc.destroy();
  }
  const restored = await connect('OWNER');
  expect(restored.state!.music.source.value).toBe('focus');
  expect(restored.state!.meetingUrl).toBe('https://example.com/meeting');
  expect(restored.state!.poll!.closed).toBe(true);
  expect(Object.keys(restored.state!.poll!.votes)).toHaveLength(2);
  expect(restored.state!.timer.endsAt).toBeGreaterThan(Date.now());
  expect(restored.state!.participants).toEqual([]);
  expect(restored.state!.presenter).toBe(null);
});
test('named cursors, shared music with individual listening, timer, reactions and call readiness work in two browsers', async ({
  page,
  browser,
}) => {
  await login(page, 'OWNER');
  const viewer = await browser.newPage();
  await login(viewer, 'VIEWER');
  try {
    await page.mouse.move(700, 460);
    const cursor = viewer
      .locator('.remote-cursor')
      .filter({ hasText: users.find((u) => u.role === 'OWNER').displayName });
    await expect(cursor).toBeVisible();
    const colors = await cursor.locator('span').evaluate((element) => ({
      text: getComputedStyle(element).color,
      background: getComputedStyle(element).backgroundColor,
    }));
    expect(colors.text).not.toBe(colors.background);
    await page
      .getByRole('button', { name: 'Включить для всех', exact: true })
      .click();
    await expect(viewer.locator('.room-music')).toContainText('играет');
    expect(
      await viewer
        .locator('audio')
        .evaluate((el: HTMLAudioElement) => el.paused),
    ).toBe(true);
    expect(await viewer.locator('audio').getAttribute('src')).toBeNull();
    await viewer.getByRole('button', { name: 'Слушать', exact: true }).click();
    await expect
      .poll(() =>
        viewer
          .locator('audio')
          .evaluate((el: HTMLAudioElement) => !el.paused && el.duration === 24),
      )
      .toBe(true);
    await viewer.getByRole('slider', { name: 'Моя громкость' }).fill('0.1');
    expect(
      await viewer
        .locator('audio')
        .evaluate((el: HTMLAudioElement) => el.volume),
    ).toBeCloseTo(0.1);
    await viewer
      .getByRole('button', { name: 'Выключить у меня', exact: true })
      .click();
    await expect
      .poll(() =>
        viewer.locator('audio').evaluate((el: HTMLAudioElement) => el.paused),
      )
      .toBe(true);
    await expect(page.locator('.room-music')).toContainText('играет');
    await section(page, 'Таймер');
    await section(viewer, 'Таймер');
    await expect(page.locator('.timer-editor input')).toHaveCount(4);
    await expect(page.locator('.timer-editor').locator('..').getByRole('button',{name:'Запустить таймер',exact:true})).toHaveCount(1);
    await page.getByLabel('Единицы минут',{exact:true}).fill('1');
    await page
      .getByRole('button', { name: 'Запустить таймер', exact: true })
      .click();
    await expect(
      viewer.getByRole('status').filter({ hasText: 'Идёт отсчёт' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Пауза таймера', exact: true })
      .click();
    await expect(
      viewer.getByRole('status').filter({ hasText: 'Остановлен' }),
    ).toBeVisible();
    expect(
      await viewer.getByLabel('Общий таймер', { exact: true }).textContent(),
    ).toBe(
      await page.getByLabel('Общий таймер', { exact: true }).textContent(),
    );
    await viewer
      .getByRole('button', { name: 'Реакция 🎉', exact: true })
      .click();
    await expect(page.locator('.room-reaction-feed')).toContainText(
      users.find((u) => u.role === 'VIEWER').displayName,
    );
    await section(page, 'Голосование');
    await section(viewer, 'Голосование');
    await page
      .getByLabel('Вопрос голосования', { exact: true })
      .fill('Продолжаем?');
    await page
      .getByRole('button', { name: 'Начать голосование', exact: true })
      .click();
    await viewer.getByRole('button', { name: 'Да', exact: true }).click();
    await expect(page.getByLabel('Голосов за Да', { exact: true })).toHaveText(
      '1',
    );
    await page
      .getByRole('button', { name: 'Завершить голосование', exact: true })
      .click();
    await expect(
      viewer.getByRole('button', { name: 'Да', exact: true }),
    ).toBeDisabled();
    await section(page, 'Созвон');
    await section(viewer, 'Созвон');
    await page
      .getByLabel('Ссылка на созвон', { exact: true })
      .fill('https://example.com/meeting');
    await page
      .getByRole('button', { name: 'Сохранить ссылку', exact: true })
      .click();
    await expect(
      viewer.getByRole('link', { name: 'Открыть созвон ↗' }),
    ).toHaveAttribute('href', 'https://example.com/meeting');
    await viewer
      .getByRole('button', { name: 'Готов к созвону', exact: true })
      .click();
    await viewer
      .getByRole('button', { name: 'Поднять руку', exact: true })
      .click();
    await expect(page.locator('.room-participants')).toContainText(
      'поднята рука',
    );
    await viewer.close();
    await expect(page.locator('.room-participants li')).toHaveCount(0);
    await page.reload();
    await page.getByRole('button').filter({ hasText: 'OWNER' }).click();
    await expect(page.locator('.connection-status')).toHaveText('connected');
    await page
      .getByRole('button', { name: 'Совместная работа', exact: true })
      .click();
    await expect(page.locator('.room-music')).toContainText('играет');
  } finally {
    if (!viewer.isClosed()) await viewer.close();
  }
});
test('Frame presentation follows only by consent and releases the presenter on disconnect', async ({
  page,
  browser,
}) => {
  const seed = await connect('OWNER');
  for (let i = 0; i < 2; i++)
    seed.doc.getMap('nodes').set(`frame-${i}`, {
      id: `frame-${i}`,
      type: 'frame',
      position: { x: i * 1700, y: 0 },
      style: { width: 520, height: 320 },
      data: { title: `Slide ${i + 1}` },
    });
  await login(page, 'OWNER');
  const viewer = await browser.newPage();
  await login(viewer, 'VIEWER');
  try {
    await section(page, 'Показ');
    await section(viewer, 'Показ');
    await page
      .getByRole('button', { name: 'Стать ведущим', exact: true })
      .click();
    await expect(viewer.locator('.session-panel')).toContainText(
      `Ведущий: ${users.find((u) => u.role === 'OWNER').displayName}`,
    );
    const previous = await viewer
      .locator('.react-flow__viewport')
      .getAttribute('style');
    await page.getByRole('button', { name: '1. Slide 1', exact: true }).click();
    await expect.poll(() => seed.state?.camera?.frameId).toBe('frame-0');
    expect(
      await viewer.locator('.react-flow__viewport').getAttribute('style'),
    ).toBe(previous);
    await viewer
      .getByRole('button', { name: 'Следовать за ведущим', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Следующий Frame', exact: true })
      .click();
    await expect.poll(() => seed.state?.camera?.frameId).toBe('frame-1');
    await expect
      .poll(() => viewer.locator('.react-flow__viewport').getAttribute('style'))
      .not.toBe(previous);
    await viewer
      .getByRole('button', { name: 'Перестать следовать', exact: true })
      .click();
    const stopped = await viewer
      .locator('.react-flow__viewport')
      .getAttribute('style');
    await page
      .getByRole('button', { name: 'Предыдущий Frame', exact: true })
      .click();
    await expect.poll(() => seed.state?.camera?.frameId).toBe('frame-0');
    expect(
      await viewer.locator('.react-flow__viewport').getAttribute('style'),
    ).toBe(stopped);
    await viewer
      .getByRole('button', { name: 'Следовать за ведущим', exact: true })
      .click();
    await viewer.mouse.move(520, 600);
    await viewer.mouse.down({ button: 'middle' });
    await viewer.mouse.move(650, 680, { steps: 8 });
    await viewer.mouse.up({ button: 'middle' });
    await expect(
      viewer.getByRole('button', { name: 'Следовать за ведущим', exact: true }),
    ).toBeVisible();
    seed.doc.getMap('nodes').delete('frame-0');
    await expect.poll(() => seed.state?.camera?.frameId).toBeUndefined();
    expect(seed.state?.presenter).not.toBeNull();
    await page.goto('about:blank');
    await expect(viewer.locator('.session-panel')).toContainText(
      'Ведущий пока не выбран',
    );
  } finally {
    await viewer.close();
  }
});
